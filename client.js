
const assert = require("assert");
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

	//TODO: Refactor into verbWithBody call
	async _putJSON( url, payload ){
		const fullURL = this.url + url;
		try {
			const response = await rp({
				method: "PUT",
				uri: fullURL,
				json: payload
			});
			return response;
		}catch (e) {
			const error = new Error("Unable to PUT " + fullURL );
			error.cause = e;
			throw error;
		}
	}

	//TODO: Refactor into verbWithBody call
	async _postJSON( url, payload ){
    	const fullURL = this.url + url;
		try {
			const response = await rp({
				method: "POST",
				uri: fullURL,
				json: payload
			});
			return response;
		}catch (e) {
			const error = new Error("Unable to POST " + fullURL );
			if( e.statusCode == 422 || e.statusCode == 423 ) {
				error.cause = new Error(JSON.stringify(e.response.body));
			}else if(e.statusCode == 500 ){
				error.cause = new Error("Server error: " + e.statusMessage);
			}else {
				error.cause = e;
			}
			throw error;
		}
	}

    async status() {
    	return await this._getJSON("/status");
	}

	provision( domainName, plainIngress, certificateName ) {
		return this._putJSON( "/v1/" + domainName, {config: {plainIngress, certificateName} } );
	}

	async generateCertificates( plainIngress, domainNames ){
    	assert(plainIngress);
    	assert(domainNames);
    	const response = await this._postJSON("/v1/provision", {
    		config: {
			    plainIngress,
			    domainNames
		    }
	    });
    	if( response.errors ){
    		throw new Error( response.errors );
	    }
	    if( !response.ok ){
	    	throw new Error( "An unexpcted error occured" );
	    }
	    return response.provisioned;
	}
}

async function connect( args, logger ){
	const controlPlaneURL = args.service;
	return new ControlClient(controlPlaneURL);
}

module.exports = {
	connect
};
