FROM node:18-alpine as builder

# Note: Build this from the root directory:
# cd package-manager
# docker build -f apps/appcontainer-node/app/Dockerfile -t pm-appcontainer-node .
# docker build -t pm-appcontainer-node ../../../..

# Environment

WORKDIR /src

# Common

COPY package.json tsconfig.json tsconfig.build.json yarn.lock lerna.json commonPackage.json .yarnrc.yml ./
COPY scripts ./scripts
COPY .yarn ./.yarn

# Shared dependencies
COPY shared ./shared


# App dependencies
RUN mkdir -p apps/appcontainer-node
COPY apps/appcontainer-node/packages apps/appcontainer-node/packages

# App
COPY apps/appcontainer-node/docker-static-app apps/appcontainer-node/app

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
WORKDIR /src/apps/appcontainer-node/app
ENV APP_CONTAINER_PORT=8090
# # ENV HTTP_SERVER_API_KEY_READ=
# # ENV HTTP_SERVER_API_KEY_WRITE=
# ENV HTTP_SERVER_BASE_PATH="/data"
EXPOSE 8090

ENTRYPOINT ["/usr/bin/dumb-init", "--", "node", "dist/index.js"]

