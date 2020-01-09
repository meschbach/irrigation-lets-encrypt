const express = require("express");
const {morgan_to_logger} = require("./junk");
const EventEmitter = require("events");

const Future = require("junk-bucket/future");
const IrrigationClient = require("irrigation").DeltaClient;

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

function buildWellKnownHTTPService( logger, challenges, args ){
	const app = express();
	app.use(morgan_to_logger("short", logger));
	app.get( "/.well-known/acme-challenge/:token", function( req, resp ) {
		const host = req["host"];
		const token = req.params.token;

		const hostChallenges = challenges[host];
		const response = hostChallenges[token];

		logger.info("Challenge request: ", {host, token, response});
		resp.end(response);
	});
	return bindTo(logger, app, args["wellknown-port"], args["wellknown-iface"]);
}

class Core {
	constructor( irrigationClient, letsEncrypt, config, logger ) {
		this.sites = {};
		this.irrigationClient = irrigationClient;
		this.letsEncrypt = letsEncrypt;
		this.config = config;
		this.logger = logger;
	}

	//TODO: Merge with provisionDomains
	async provision( name, incomingConfig ){
		const config = {
            status: "proivsioning",
            plainIngress: incomingConfig.plainIngress,
            secureIngress: incomingConfig.secureIngress,
			certificateName: incomingConfig.certificateName,
        };
		this.sites[name] = config;
		const wellknownTargetPool = this.config["wellknown-target-pool"];

		//Get the metadata we'll need
		const plainIngress = await this.irrigationClient.describeIngress(config.plainIngress);
		const rules = await plainIngress.describeRules();

		//Configure the .well-known to target this service
		rules.unshift({type: "host.path-prefix", host: name, prefix: "/.well-known", target: wellknownTargetPool });
		await plainIngress.applyRules(rules);

		const asymmetricPair = await this.letsEncrypt.provision(name);
		this.logger.info("Asymmetric key generated: ", asymmetricPair);
		await this.irrigationClient.uploadCertificate( config.certificateName, asymmetricPair.cert.toString(), asymmetricPair.key.toString() );
		const context = {
			cert: asymmetricPair.cert.toString(),
			key: asymmetricPair.key.toString()
		};
		config.context = context;
		config.status = "provisioned";
	}

	//TODO: Merge with provision
	async provisionDomains( ingress, domains ){
		const config = {
			status: "proivsioning",
			plainIngress: ingress,
			domains: domains
		};
		domains.forEach((domain) => {
			this.sites[domain] = config;
		});
		const wellknownTargetPool = this.config["wellknown-target-pool"];

		//Get the metadata we'll need
		const plainIngress = await this.irrigationClient.describeIngress(config.plainIngress);
		const rules = await plainIngress.describeRules();

		//Configure the .well-known to target this service
		domains.forEach((domain) => {
			rules.unshift({type: "host.path-prefix", host: domain, prefix: "/.well-known", target: wellknownTargetPool });
		});
		await plainIngress.applyRules(rules);

		const asymmetricPair = await this.letsEncrypt.provisionDomains(domains);
		this.logger.info("Asymmetric key genrated: ", asymmetricPair);
		const context = {
			cert: asymmetricPair.cert.toString(),
			key: asymmetricPair.key.toString()
		};
		config.context = context;
		config.status = "provisioned";
		return context;
	}
}

const acme = require('acme-client');
const {buildHTTPControlPlane} = require("./service-http-control");

async function runService( logger, args ){
	const irrigationClient = new IrrigationClient(args["irrigation-url"]);
	if( args["irrigation-token"] ){
		irrigationClient.useBearerToken( args["irrigation-token"] );
	}

	const directoryURL = args["le-staging"] ? acme.directory.letsencrypt.staging :  acme.directory.letsencrypt.production;
	const acmeClient = new acme.Client({
		directoryUrl: directoryURL,
		accountKey: await acme.openssl.createPrivateKey()
	});
	acmeClient.verifyChallenge = function(){
		//TODO: This is cheating...because network topology will not always make sense
		return true;
	};

	function log(msg){
		logger.info(msg);
	}

	function defaultValue( hash, key, defaultValue = {}) {
		const value = hash[key] || defaultValue;
		hash[key] = value;
		return value;
	}

	function challengeCreateFn(authz, challenge, keyAuthorization) {
		// logger.info('Challenge requested: ', {authz, challenge, keyAuthorization });

		/* http-01 */
		if (challenge.type === 'http-01') {
			const domainName = authz.identifier.value;
			const tokenName = challenge.token;
			const tokenPath = tokenName;
			const tokenContent = keyAuthorization;

			logger.info('HTTP Challenge requested: ', {tokenPath, domainName });
			const domainChallenges = defaultValue( letsEncrypt.httpChallenges, domainName );
			domainChallenges[tokenPath] = tokenContent;
		}

		/* dns-01 */
		else if (challenge.type === 'dns-01') {
			const dnsRecord = `_acme-challenge.${authz.identifier.value}`;
			const recordValue = keyAuthorization;

			log(`Creating TXT record for ${authz.identifier.value}: ${dnsRecord}`);

			/* Replace this */
			log(`Would create TXT record "${dnsRecord}" with value "${recordValue}"`);
			// await cloudflare.createRecord(dnsRecord, 'TXT', recordValue);
		}
	}

	function challengeRemoveFn(authz, challenge, keyAuthorization) {
		log('Triggered challengeRemoveFn()');

		/* http-01 */
		if (challenge.type === 'http-01') {
			const filePath = `/var/www/html/.well-known/acme-challenges/${challenge.token}`;

			log(`Removing challenge response for ${authz.identifier.value} at path: ${filePath}`);

			/* Replace this */
			log(`Would remove file on path "${filePath}"`);
			// await fs.unlink(filePath);
		}

		/* dns-01 */
		else if (challenge.type === 'dns-01') {
			const dnsRecord = `_acme-challenge.${authz.identifier.value}`;
			const recordValue = keyAuthorization;

			log(`Removing TXT record for ${authz.identifier.value}: ${dnsRecord}`);

			/* Replace this */
			log(`Would remove TXT record "${dnsRecord}" with value "${recordValue}"`);
			// await cloudflare.removeRecord(dnsRecord, 'TXT');
		}
	}

	const letsEncrypt = {
		httpChallenges: {},
		provision: async (domainName) => {
			/* Create CSR */
			const [key, csr] = await acme.openssl.createCsr({
				commonName: domainName
			});

			try {
				/* Certificate */
				const cert = await acmeClient.auto({
					csr,
					email: args["le-email"],
					termsOfServiceAgreed: true,
					challengeCreateFn,
					challengeRemoveFn
				});

				return {
					key: key,
					cert: cert
				};
			}catch(e){
				throw new Error(e.message);
			}
		},
		provisionDomains: async (domains) => {
			/* Create CSR */
			const [key, csr] = await acme.openssl.createCsr({
				commonName: domains[0],
				altNames: domains.slice(1)
			});

			try {
				/* Certificate */
				const cert = await acmeClient.auto({
					csr,
					email: args["le-email"],
					termsOfServiceAgreed: true,
					challengeCreateFn,
					challengeRemoveFn
				});

				return {
					key: key,
					cert: cert
				};
			}catch(e){
				throw new Error(e.message);
			}
		}
	};
	const wellKnown = buildWellKnownHTTPService( logger.child({plane: "challenge"}), letsEncrypt.httpChallenges, args );


	const core = new Core( irrigationClient, letsEncrypt, args, logger );
	const httpControl = buildHTTPControlPlane( core, logger.child({plane: "control"}), args );
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
        "http://" + wellKnownAddress.host + ":" + wellKnownAddress.port );
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
	.option("le-staging", {description: "Use the Let's Encrypt staging servers", default: false})
	.option("le-email", {description: "Let's Encrypt E-mail account to use", required:true})
	.showHelpOnFail()
	.argv;

const {main} = require("junk-bucket");
const {formattedConsoleLog} = require("junk-bucket/logging-bunyan");

main( async (logger) => {
	await runService(logger, argv);
}, formattedConsoleLog("irrigation-lets-encrypt") );
