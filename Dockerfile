# https://hub.docker.com/_/nginx
FROM nginx:alpine3.22

EXPOSE 5000

ENV HOME=/home/etl
WORKDIR $HOME

RUN apk add --no-cache git nodejs-current npm mosquitto

WORKDIR $HOME/

ADD package.json ./
ADD package-lock.json ./

RUN npm install

COPY ./ $HOME/

RUN cd web \
    && npm install \
    && npm run lint \
    && npm run check \
    && npm run build \
    && cd ..

RUN npm run lint \
    && npm run dist

CMD ["./start"]
