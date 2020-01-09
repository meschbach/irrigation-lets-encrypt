FROM node:13-alpine

WORKDIR /app
ADD . /app
ENV NODE_ENV production
RUN apk add --no-cache make gcc g++ python openssl git && \
    npm install && \
    apk del make gcc g++ python git

ENTRYPOINT ["node", "service.js"]
CMD []