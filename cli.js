
const bunyan = require("bunyan");
const logger = bunyan.createLogger({name:"fog-config"});

const {main} = require("junk-bucket");

const {connect} = require("./client");

const argv = require("yargs")
	.option("service", {describe: "Control plane to communicate with", default: "http://localhost:9001"})
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
