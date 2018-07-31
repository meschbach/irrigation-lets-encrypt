const express = require("express");
const morgan = require("morgan");
const EventEmitter = require("events");

const Future = require("junk-bucket/future");

function bindTo( logger, service, port, iface ){
	const listenerAddress = new Future();

	const socket = service.listen( port, iface, () => {
        listenerAddress.accept(socket.address());
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
	const app = express();
	app.use(morgan("short"));

	app.get("/status", (req, resp) => {
		resp.json({ok:true});
	});

	return bindTo(logger, app, options["control-port"], options["control-iface"]);
}

class Core {
	constructor() {
	}
}

async function runService( logger, args ){
	const core = new Core();
	const httpControl = buildHTTPControlPlane( core, logger, args );
	const address = await httpControl.at;
	logger.info("Control plane bound to ", address);
}

const argv = require("yargs")
	.option("control-port", {describe: "Control plane port", default: 9001})
    .option("control-address", {describe: "Control plane address"})
	.showHelpOnFail()
	.argv;

const bunyan = require("bunyan");
const logger = bunyan.createLogger({name:"fog-config"});
const {main} = require("junk-bucket");

main( async () => {
	await runService(logger, argv);
}, logger );
