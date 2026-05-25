FROM node:20-alpine
WORKDIR /usr/src/app
COPY package.json package-lock.json* ./
RUN npm install --production
RUN apk add --no-cache python3 py3-pip openssl
COPY . .
RUN python3 -m pip install --no-cache-dir --break-system-packages -r GMapLink2KML/requirements.txt
EXPOSE 4000
ENV PORT=4000
CMD ["node", "server.js"]
