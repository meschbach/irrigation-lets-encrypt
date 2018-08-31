let bodyParser = require('body-parser');

const {make_async} = require("junk-bucket/express");
const Future = require("junk-bucket/future");

const express = require("express");
const morgan = require("morgan");

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
	app.use(morgan("short", {
		stream: {write: (msg) => {
				logger.info(msg);
			} }
	}));
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

module.exports = {
	buildHTTPControlPlane
};
