
const Future = require("junk-bucket/future");
const rp = require("request-promise-native");

class ControlClient {
    constructor( url ){
    	this.url = url;
    }

    async _getJSON( url ){
    	const fullURL = this.url + url;
    	try {
			const response = await rp({
				uri: fullURL,
				json: true
			});
			return response;
        }catch (e) {
			const error = new Error("Unable to GET " + fullURL );
			error.cause = e;
			throw error;
        }
	}

    async status() {
    	return await this._getJSON("/status");
	}
}

async function connect( args, logger ){
	const controlPlaneURL = args.service;
	return new ControlClient(controlPlaneURL);
}

module.exports = {
	connect
}
