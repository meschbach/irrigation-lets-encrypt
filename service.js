const express = require("express");
const morgan = require("morgan");
const EventEmitter = require("events");

const {make_async} = require("junk-bucket/express");
const Future = require("junk-bucket/future");
const IrrigationClient = require("irrigation").DeltaClient;

let bodyParser = require('body-parser');

function bindTo( logger, service, port, iface ){
	const listenerAddress = new Future();

	const socket = service.listen( port, iface, () => {
		const addr = socket.address();
		const address = addr.address;
		const host = address == "::" ? "localhost" : address;
		const port = addr.port;
        listenerAddress.accept({ host, port });
	});
	socket.on("error", (e) => {
        listenerAddress.reject(e);
	});

	return {
		at: listenerAddress.promised,
		end: () => {
			socket.end();
		}
	}
}

function buildHTTPControlPlane( core, logger, options ){
	const app = make_async(express());
	app.use(morgan("short"));
	app.use(bodyParser.json());

	app.get("/status", (req, resp) => {
		resp.json({ok:true});
	});

	app.get("/v1/:site", (req, resp) => {
		const name = req.params.site;

		if( !core.sites[name]) {
			resp.status(404);
			return resp.end();
		}

		resp.json({v: 1, site: core.sites[name] });
	});

	app.a_put("/v1/:site", async (req, resp) => {
        const name = req.params.site;
		logger.info("Request body: ", req.body);
        if( !req.body || !req.body.config ){
	        resp.status(422);
	        return resp.end();
        }
        const config = req.body.config;
        logger.info("Configuration: ", config);
        if( !config.plainIngress ){
            resp.status(422);
            return resp.end();
		}

		await core.provision( name, config );
		resp.status(201);
		resp.end();
	});

	return bindTo(logger, app, options["control-port"], options["control-iface"]);
}

function buildWellKnownHTTPService( logger, greenlock, args ){
	const app = express();
	app.use(morgan("short"));
	app.use(greenlock.middleware());
	return bindTo(logger, app, args["wellknown-port"], args["wellknown-port"]);
}

const Greenlock = require("greenlock");

class Core {
	constructor( irrigationClient, letsEncrypt, config ) {
		this.sites = {};
		this.irrigationClient = irrigationClient;
		this.letsEncrypt = letsEncrypt;
	}

	async provision( name, incomingConfig ){
		const config = {
            status: "proivsioning",
            plainIngress: incomingConfig.plainIngress,
            secureIngress: incomingConfig.secureIngress,
			certificateName: incomingConfig.certificateName,
        };
		this.sites[name] = config;

		//Get the metadata we'll need
		const plainIngress = await this.irrigationClient.describeIngress(config.plainIngress);
		const rules = await plainIngress.describeRules();

		//Configure the .well-known to target this service
		rules.unshift({type: "host.path-prefix", host: name, prefix: "/.well-known", target: config["wellknown-target-pool"]});
		await plainIngress.applyRules(rules);

		const asymmetricPair = await this.letsEncrypt.provision(name);
		await this.irrigationClient.uploadCertificate( config.certificateName, asymmetricPair.certificate, asymmetricPair.key );
		config.status = "provisioned";
	}
}

async function runService( logger, args ){
	const irrigationClient = new IrrigationClient(args["irrigation-url"]);
	if( args["irrigation-token"] ){
		irrigationClient.useBearerToken( args["irrigation-token"] );
	}

	const greenlock = Greenlock.create({
		version: "draft-12",
        server: 'https://acme-staging-v02.api.letsencrypt.org/directory',
        agreeToTerms: true
    });
	const letsEncrypt = {
		provision: async (domainName) => {
			const result = await greenlock.register({
				domains: [domainName],
				email: args["le-email"],
				agreeTos: true,
				rsaKeySize: 2048
			});
			return {
				certificate: result.cert,
				key: result.privkey
			}
		}
	};
	const wellKnown = buildWellKnownHTTPService( logger, greenlock, args );


	const core = new Core( irrigationClient, letsEncrypt, args );
	const httpControl = buildHTTPControlPlane( core, logger, args );
	const address = await httpControl.at;
    logger.info("Control plane bound to ", address);
    const controlTargetPool = args["control-target-pool"];
    await irrigationClient.createTargetPool(controlTargetPool);
    await irrigationClient.registerTarget(
    	controlTargetPool,
		args["control-target-name"] || "irrigation-le-control-" + address.port,
		"http://" + address.host + ":" + address.port );

	const wellKnownAddress = await wellKnown.at;
    logger.info("Well Known ", wellKnownAddress);
    const wellKnownTargetPool = args["wellknown-target-pool"];
	await irrigationClient.createTargetPool(wellKnownTargetPool);
    await irrigationClient.registerTarget(
        wellKnownTargetPool,
        args["wellknown-target-name"] || "irrigation-le-wellknown-" + address.port,
        "http://" + address.host + ":" + address.port );
}

const argv = require("yargs")
	//Irrigation options
    .option("irrigation-url", {describe: "Irragation control plane URL", default: "http://localhost:9000"})
    .option("irrigation-token", {describe: "Token for interacting with Irrigation"})
	//Control Options
	.option("control-port", {describe: "Control plane port", default: 9001})
    .option("control-address", {describe: "Control plane address"})
    .option("control-target-pool", {describe: "Target pool to register the control plane in", default: "lets-encrypt-control"})
    .option("control-target-name", {describe: "Name fo the target to register as"})
	// Well Known Options
	.option("wellknown-target-pool", {describe: "target pool to register within", default: "lets-encrypt-challenge"})
	.option("wellknown-target-name", {describe: "target name to register as"})
	// LE Account options
	.option("le-email", {description: "Let's Encrypt E-mail account to use", required:true})
	.showHelpOnFail()
	.argv;

const bunyan = require("bunyan");
const logger = bunyan.createLogger({name:"fog-config"});
const {main} = require("junk-bucket");

main( async () => {
	await runService(logger, argv);
}, logger );
