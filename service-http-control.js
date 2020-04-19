const assert = require("assert");

let bodyParser = require('body-parser');

const {make_async} = require("junk-bucket/express");
const {Future} = require("junk-bucket/future");
const {listen} = require("junk-bucket/sockets");

const express = require("express");
const {tracingMiddleware} = require("junk-bucket/express-opentracing");
const {logMorganToContext} = require("junk-bucket/express-morgan");

function buildHTTPControlPlane( core, logger, options, serviceContext ){
	assert(serviceContext);

	//Extract options
	const controlPort = options["control-port"];
	const controlInterface = options["control-iface"];

	const app = make_async(express());
	app.use(logMorganToContext(serviceContext, "short"));
	app.use(tracingMiddleware());
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

	app.a_post("/v1/provision", async (req, resp) => {
		function badRequest(what){
			resp.status(422);
			return resp.json({
				errors: what
			});
		}
		if( !req.body || !req.body.config ){
			return badRequest({body: ["Expected JSON body with config element"]});
		}
		const config = req.body.config;
		//TODO: Ensure plain ingress is a string
		if( !config.plainIngress ){ return badRequest({body:{config: {plainIngress: ["Expected ingress name"]}}}) }
		if( !config.domainNames ){ return badRequest({body:{config: {domainNames: ["Expected domain names to be validated"]}}}) }

		try {
			const provisioned = await core.provisionDomains(config.plainIngress, config.domainNames);
			resp.json({
				ok: true,
				provisioned: provisioned
			});
		}catch (e) {
			logger.warn("Failed to provision domains because of error", config, e);
			resp.status(423);
			resp.json({
				letsEncrypt: [e.message]
			});
		}
	});

	//Bind to the target
	return listen(serviceContext, app, controlPort, controlInterface);
}

module.exports = {
	buildHTTPControlPlane
};
