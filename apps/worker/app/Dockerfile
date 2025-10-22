FROM node:18-alpine as builder

# Note: Build this from the root directory:
# cd package-manager
# docker build -f apps/worker/app/Dockerfile -t pm-worker .
# docker build -t pm-worker ../../../..

# Environment

WORKDIR /src

# Common

COPY package.json tsconfig.json tsconfig.build.json yarn.lock lerna.json commonPackage.json .yarnrc.yml ./
COPY scripts ./scripts
COPY .yarn ./.yarn

# Shared dependencies
COPY shared ./shared


# App dependencies
RUN mkdir -p apps/worker
COPY apps/worker/packages apps/worker/packages

# App
COPY apps/worker/app apps/worker/app

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

RUN apk add --no-cache dumb-init ffmpeg

# Run as non-root user
USER 1000
WORKDIR /src/apps/worker/app
# ENV APP_CONTAINER_PORT=8090
# # ENV HTTP_SERVER_API_KEY_READ=
# # ENV HTTP_SERVER_API_KEY_WRITE=
# ENV HTTP_SERVER_BASE_PATH="/data"
# EXPOSE 8090

ENTRYPOINT ["/usr/bin/dumb-init", "--", "./docker-entrypoint.sh"]

