
const bunyan = require("bunyan");
const logger = bunyan.createLogger({name:"fog-config"});

const {main} = require("junk-bucket");

const {connect} = require("./client");

const argv = require("yargs")
	.option("service", {describe: "Control plane to communicate with", default: "http://localhost:9001"})
	.command( "provision <dns-name> <plain-ingress> <certificate-name>", "Provisions the given DNS name", (yargs) => {
		yargs.positional("dns-name", { description: "DNS to be hosted", required:true});
		yargs.positional("plain-ingress", {description: "HTTP service to be challenged for verification", required: true});
		yargs.positional("certificate-name", {description: "Certificate name", required: true});
	},(argv) => {
		main( async () => {
			const client = await connect(argv, logger);
			const result = await client.provision(argv["dns-name"], argv["plain-ingress"], argv["secure-ingress"], argv["certificate-name"]);
			logger.info("Provisioning: ", result);
		}, logger)
	})
	.command( "status", "States the status of the system", (yargs) => {},(argv) => {
		main( async () => {
			const client = await connect(argv, logger);
			const status = await client.status();
			logger.info("Status: ", status);
		}, logger)
	} )
	.demandCommand()
	.showHelpOnFail()
	.argv;
