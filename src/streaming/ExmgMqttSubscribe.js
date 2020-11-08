import mqtt from 'mqtt';
import { v4 as getUuid } from 'uuid';
import {getConsoleFunc} from './ExmgConsole';

const DEBUG = true;

const log = getConsoleFunc(DEBUG, 'exmg-mqtt');

const MQTT_HOST = 'ws://xvm-190-41.dc0.ghst.net:8885/mqtt';
const MQTT_TOPIC = '/mqtt';
const MQTT_CLIENT_ID = 'exmg-mqtt-web-' + getUuid();
const MQTT_USERNAME = 'user1';
const MQTT_PASSWORD = 'liverymqtt123';

const ENABLE_SINGLETON = true;

let singletonMqttClient;

if (ENABLE_SINGLETON) {
    singletonMqttClient = createMqttSubscribeClient();
}

/**
 * @param {string} host
 * @param {string} clientId
 * @param {string} username
 * @param {string} password
 *
 * @returns {mqtt.Client} See https://github.com/mqttjs/MQTT.js
 */
function createMqttSubscribeClient(host = MQTT_HOST,
    clientId = MQTT_CLIENT_ID,
    username = MQTT_USERNAME,
    password = MQTT_PASSWORD) {

    log('connecting MQTT subscribe');

    const options = {
        clientId,
        username,
        password,
        protocolId: 'MQTT',
        protocolVersion: 4, // actually meaning 3.1.1, while 3 means 3.1 and is incompatible with the latter
        keepalive: 4,
        reconnectPeriod: 1000,
        connectTimeout: 8 * 1000,
        clean: true
    };

    const client = mqtt.connect(host, options);
    client.on('connect', function () {
        // TODO: handle/retry initial connection/sub failures
        client.subscribe(MQTT_TOPIC, function (err) {
            if (err) {
                console.error('EXMG MQTT:', 'subscribe error: ' + err);
            } else {
                log('subscribed');
            }
        });
    });
    return client;
}

function getSingletonMqttClient() {
    return singletonMqttClient;
}

export {
    createMqttSubscribeClient,
    getSingletonMqttClient
};
