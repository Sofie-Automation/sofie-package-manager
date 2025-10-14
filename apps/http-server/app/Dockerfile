FROM node:18-alpine as builder

# Note: Build this from the root directory:
# cd package-manager
# docker build -f apps/http-server/app/Dockerfile -t pm-http-server .
# docker build -t pm-http-server ../../../..

# Environment

WORKDIR /src

# Common

COPY package.json tsconfig.json tsconfig.build.json yarn.lock lerna.json commonPackage.json .yarnrc.yml ./
COPY scripts ./scripts
COPY .yarn ./.yarn

# Shared dependencies
COPY shared ./shared


# App dependencies
RUN mkdir -p apps/http-server
COPY apps/http-server/packages apps/http-server/packages

# App
COPY apps/http-server/app apps/http-server/app

# Install
RUN yarn install

# Build
RUN yarn build

# Purge dev-dependencies:
RUN yarn workspaces focus -A --production

RUN rm -r scripts


# Create deploy-image:
FROM node:18-alpine

COPY --from=builder /src /src

RUN apk add --no-cache dumb-init

# Run as non-root user
USER 1000
WORKDIR /src/apps/http-server/app
ENV HTTP_SERVER_PORT=8080
# ENV HTTP_SERVER_API_KEY_READ=
# ENV HTTP_SERVER_API_KEY_WRITE=
ENV HTTP_SERVER_BASE_PATH="/data"
EXPOSE 8080

ENTRYPOINT ["/usr/bin/dumb-init", "--", "node", "dist/index.js"]
