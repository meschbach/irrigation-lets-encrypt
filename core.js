
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
		rules.push({type: "host.path-prefix", host: name, prefix: "/.well-known", target: wellknownTargetPool });
		await plainIngress.applyRules(rules);

		try {
			const asymmetricPair = await this.letsEncrypt.provision(name);
			this.logger.debug("Asymmetric key generated: ", asymmetricPair);
			await this.irrigationClient.uploadCertificate(config.certificateName, asymmetricPair.cert.toString(), asymmetricPair.key.toString());
			const context = {
				cert: asymmetricPair.cert.toString(),
				key: asymmetricPair.key.toString()
			};
			config.context = context;
			config.status = "provisioned";
		}finally {
			const remainingRules = rules.filter((r) => r.target != wellknownTargetPool);
			await plainIngress.applyRules(remainingRules);
		}
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
		const urlString = await plainIngress.address();
		const url = new URL(urlString);
		let portSpec;
		if( url.port == 80 ){
			portSpec = "";
		} else {
			portSpec = ":" + url.port;
		}
		const rules = await plainIngress.describeRules();

		//Configure the .well-known to target this service
		domains.forEach((domain) => {
			rules.push({type: "host.path-prefix", host: domain + portSpec, prefix: "/.well-known", target: wellknownTargetPool });
		});
		await plainIngress.applyRules(rules);

		try {
			const asymmetricPair = await this.letsEncrypt.provisionDomains(domains);
			this.logger.debug("Asymmetric key genrated: ", asymmetricPair);
			const context = {
				cert: asymmetricPair.cert.toString(),
				key: asymmetricPair.key.toString()
			};
			config.context = context;
			config.status = "provisioned";
			return context;
		} finally {
			const remainingRules = rules.filter((r) => r.target != wellknownTargetPool);
			await plainIngress.applyRules(remainingRules);
		}
	}
}

module.exports = {
	Core
};
