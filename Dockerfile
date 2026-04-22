# https://hub.docker.com/_/nginx
FROM nginx:alpine3.22

# 5004: HTTP API + web UI (fronted by NLB:443)
# 1883: Mosquitto MQTT broker (fronted by NLB:1883, consumed by DJI Pilot)
EXPOSE 5004 1883

ENV HOME=/home/etl
WORKDIR $HOME

# `mosquitto` provides both the broker daemon and `mosquitto_passwd`.
RUN apk add --no-cache git nodejs-current npm mosquitto

WORKDIR $HOME/

ADD package.json ./
ADD package-lock.json ./

RUN npm install

COPY ./ $HOME/

# Bake in the mosquitto config; password file is materialised at start
# from MQTT_USERNAME / MQTT_PASSWORD env vars.
RUN mkdir -p /mosquitto/config /mosquitto/data /mosquitto/log \
    && cp mqtt/mosquitto.conf /mosquitto/config/mosquitto.conf

RUN cd web \
    && npm install \
    && npm run lint \
    && npm run check \
    && npm run build \
    && cd ..

RUN npm run lint \
    && npm run dist

RUN chmod +x ./start

CMD ["./start"]
