const {Context} = require("junk-bucket/context");
const {main} = require("junk-bucket");

const certificateClient = require("./client");
const IrrigationClient = require("irrigation/client");

main(async (logger) => {
	const testIngressName = "test-5002";

	//Create a new Irrigation client
	const irrigation = new IrrigationClient("http://localhost:9000");
	const ingressNames = await irrigation.listIngressNames();
	let plainText;
	if( ingressNames.includes(testIngressName)){
		plainText = await irrigation.describeIngress(testIngressName);
	} else {
		plainText = await irrigation.ingress(testIngressName, 5002, "node-http-proxy");
	}

	//Attempt to issue certificate
	const client = await certificateClient.connect({service: "http://localhost:9001"});
	const result = await client.generateCertificates( testIngressName, [
		"a.test.invalid","b.test.invalid",
		"cyoa.test.invalid", "something.domain.local",
		"fith.internal", "sixth.invalid"
	] );
	logger.info("Result: ", result);
});
