/*
 * Morgan/Connect logger
 */
const morgan = require("morgan");

function morgan_to_logger(format, logger){
	return morgan("short", {
		stream: {write: (msg) => {
				logger.info(msg);
			} }
	});
};

module.exports = {
	morgan_to_logger
};
