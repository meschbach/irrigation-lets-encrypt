# Irrigation Let's Encrypt

An application to obtain ACME (Let's Encrypt) certificates with an Irrigation instance.

This application drives Irrigation rules for the requested domains to request HTTP verification of a domain.  Once
verification is complete, the rules will be removed.

## Development

To get the process up and running just follow your standard NodeJS workflow with either `npm install` or `yarn install`.
All services depended upon may be overriden via environment variables.

| Dependency | Environment Var | Default |
| --- | --- | --- |
| Irrigation | IRRIGATION_URL | http://localhost:9000 |
| ACME Directory | ACME_DIR | Let's Encrypt's Production Directory |

### ACME Directory

I recommend you develop against [Pebble](https://github.com/letsencrypt/pebble) to test your changes.  This will
expatiate your local development since you'll remove the wait on LE's servers, rate limiting, and otherwise not impact
the public service they are running.  They don't have an OSX distribution as of the time of writing this, however you'll
be able to get going with Docker fairly quickly:
```shell
wget https://raw.githubusercontent.com/letsencrypt/pebble/master/docker-compose.yml
docker-compose up
```

You may need to edit the YAML file if you are on OSX, specifically the following line, to point to your IP address.
> command: pebble-challtestsrv -defaultIPv6 "" -defaultIPv4 10.32.20.111 

Additionally you'll need to run with the following command line variable set.
`NODE_TLS_REJECT_UNAUTHORIZED=0` to avoid the Pebble root certificate from being rejected.


