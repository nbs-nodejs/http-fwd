FROM node:18-alpine

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
COPY ./src ./

ENV NODE_ENV="production"

RUN npm ci

CMD ["node", "./index.js"]
