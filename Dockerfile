FROM node:20-alpine
WORKDIR /usr/src/app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY . .
EXPOSE 8500
ENV PORT=8500
CMD ["node", "server.js"]
