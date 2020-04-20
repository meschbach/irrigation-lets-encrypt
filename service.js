const express = require("express");
const {tracingMiddleware} = require("junk-bucket/express-opentracing");
const {logMorganToContext} = require("junk-bucket/express-morgan");
const EventEmitter = require("events");

const Future = require("junk-bucket/future");
const IrrigationClient = require("irrigation").DeltaClient;

const {listen} = require("junk-bucket/sockets");

/**
 * Service for responding to ACME HTTP challenges.
 * @param context lifecycle binding for the service
 * @param challenges challenge coordinator
 * @param args configuration for the service
 * @returns {Promise<string>} address of the bound service
 */
function buildWellKnownHTTPService( context, challenges, args ){
	const wellknownPort = args["wellknown-port"];
	const wellknownAddress = args["wellknown-address"];

	const app = express();
	app.use(logMorganToContext(context,"short"));
	app.use(tracingMiddleware());
	app.get( "/.well-known/acme-challenge/:token", function( req, resp ) {
		const host = req["host"];
		const token = req.params.token;

		const hostChallenges = challenges[host];
		const response = hostChallenges[token];

		context.logger.info("Challenge request: ", {host, token, response});
		resp.end(response);
	});
	return listen(context, app, wellknownPort, wellknownAddress);
}

const acme = require('acme-client');
const {buildHTTPControlPlane} = require("./service-http-control");
const {Core} = require("./core");
const {Context} = require("junk-bucket/context");

function decideOnACMEDirectory( context, args ) {
	const specificDirectory =  args["le-directory"];
	if( specificDirectory ){ return specificDirectory; }

	if( args["le-staging"] ){ return  acme.directory.letsencrypt.staging; }

	const envDirectory = process.env["ACME_DIR"];
	if( envDirectory ){ return envDirectory }

	return acme.directory.letsencrypt.production;
}

async function runService( logger, args, serviceContext ){
	/*
	 * Setup connection to Irrigation
	 */
	const irrigationClient = new IrrigationClient(args["irrigation-url"]);
	if( args["irrigation-token"] ){
		irrigationClient.useBearerToken( args["irrigation-token"] );
	}

	/*
	 * Setup Let's Encrypt configuration
	 */
	const directoryURL = decideOnACMEDirectory( serviceContext, args );
	logger.info("Using LE directory", {url: directoryURL});
	const acmeClient = new acme.Client({
		directoryUrl: directoryURL,
		accountKey: await acme.openssl.createPrivateKey() //TODO: Accounts should be persistable
	});
	acmeClient.verifyChallenge = function(){
		//TODO: This is cheating...because network topology will not always make sense
		return true;
	};

	function defaultValue( hash, key, defaultValue = {}) {
		const value = hash[key] || defaultValue;
		hash[key] = value;
		return value;
	}

	function challengeCreateFn(authz, challenge, keyAuthorization) {
		/* http-01 */
		if (challenge.type === 'http-01') {
			const domainName = authz.identifier.value;
			const tokenPath = challenge.token;
			const tokenContent = keyAuthorization;

			logger.info('HTTP Challenge requested: ', {tokenPath, domainName });
			const domainChallenges = defaultValue( letsEncrypt.httpChallenges, domainName );
			domainChallenges[tokenPath] = tokenContent;
		} else if (challenge.type === 'dns-01') {
			const dnsRecord = `_acme-challenge.${authz.identifier.value}`;
			const recordValue = keyAuthorization;
			throw new Error("DNS challenge not supproted");
		} else {
			throw new Error("Challenge not supported");
		}
	}

	function challengeRemoveFn(authz, challenge, keyAuthorization) {
		const dns = authz.identifier.value;
		const token = challenge.token;
		logger.info('Removing challenge', {dns, token});

		/* http-01 */
		if (challenge.type === 'http-01') {
			delete letsEncrypt.httpChallenges[token];
		} else if (challenge.type === 'dns-01') {
			const dnsRecord = `_acme-challenge.${authz.identifier.value}`;
			const recordValue = keyAuthorization;
			throw new Error("Not supported");
		} else {
			throw new Error("Challenge not supproted");
		}
	}

	const letsEncrypt = {
		httpChallenges: {},
		rateLimiting: {
			notBefore: 0
		},
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
			if( letsEncrypt.rateLimiting.notBefore >= Date.now() ){
				throw new Error("Rate limited upstream, breaking circuit to avoid further problems.");
			}
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
				logger.error("Unable to issue certificate", e);
				letsEncrypt.rateLimiting.notBefore = Date.now() + (12 * 60 * 1000);
				throw new Error(e.message);
			}
		}
	};
	const wellKnownAddress = await buildWellKnownHTTPService( serviceContext.subcontext("challenge"), letsEncrypt.httpChallenges, args );


	const core = new Core( irrigationClient, letsEncrypt, args, logger );
	const httpControlAddress = await buildHTTPControlPlane( core, logger.child({plane: "control"}), args, serviceContext );
    logger.info("Control plane bound to ", {address: httpControlAddress});
    const controlTargetPool = args["control-target-pool"];
    await irrigationClient.createTargetPool(controlTargetPool);
    await irrigationClient.registerTarget(
    	controlTargetPool,
		args["control-target-name"] || "irrigation-le-control-" + httpControlAddress.port,
		"http://" + httpControlAddress );

    logger.info("Well Known ", wellKnownAddress);
    const wellKnownTargetPool = args["wellknown-target-pool"];
	await irrigationClient.createTargetPool(wellKnownTargetPool);
    await irrigationClient.registerTarget(
        wellKnownTargetPool,
        args["wellknown-target-name"] || "irrigation-le-wellknown-" + httpControlAddress.port,
        "http://" + wellKnownAddress );

	logger.info("Irrigaiton LE setup and ready.");
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
	.option("wellknown-address", {describe: "target name to register as"})
	// LE Account options
	.option("le-directory", {description: "ACME Directory to sign against", default: undefined})
	.option("le-staging", {description: "Use the Let's Encrypt staging servers", default: false})
	.option("le-email", {description: "Let's Encrypt E-mail account to use", required:true})
	.showHelpOnFail()
	.argv;

const {main} = require("junk-bucket");
const {formattedConsoleLog} = require("junk-bucket/logging-bunyan");
const {tracingInit} = require("junk-bucket/express-opentracing");

const NAME = "irrigation-lets-encrypt";
main( async (logger) => {
	/*
	 * Setup service context
	 */
	const serviceContext = new Context(NAME, logger);

	/*
	 * OpenTracing
	 */
	if( process.env.JAEGER_SERVICE ) {
		const tracer = tracingInit(serviceContext);
		serviceContext.opentracing = {
			tracer
		}
	}

	/*
	 * Graceful shutdown and container shutdown
	 */
	const shutdown = () => {
		serviceContext.cleanup();
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	/*
	 * Setup the service
	 */
	try {
		await runService(logger, argv, serviceContext);
	}catch (e) {
		serviceContext.logger.error("Failed to initalize service", e);
		shutdown();
	}
}, formattedConsoleLog(NAME) );
