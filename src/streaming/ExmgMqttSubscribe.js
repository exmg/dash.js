const MQTT_HOST = "wss://mqtt.liveryvideo.com?jwt=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyLWlkIjoid2ViMSIsImF1dGgtZ3JvdXBzIjoic3Vic2NyaWJlIn0.jovY0SCF9OZbsaj9Rx4yB8aN9QYxUNAOCd7m3TEkI49mu_3u1r3kqe27dOYOc1MrHOx0ezv2OQIYjum60mOTKr1W4jtNrXtpzAkheTu_j2pOffeKiz-8oNg-C99mvlXTad0XrRCiP30R_3UoKh7GzgwgWw0eJhr37RiyPILn-5R-cuVHZoh8ddWaQHyIYk2HfQQTAHtAdc56BHPWxiN196NpjYEnBitdBBG0CTpcxTula9kBS8vvek5Sdd3SMjAT3tGw0fX3RgHJMhbQYKxdpzz_Njnfh1f4MCJgFHZiu1O7obO-TmuiT-diWP4xD0JkryJ0a3rpqh61--Bt_3NDgVJzsKvg3JpHkOJtRAaR5keHAa5BRB_j1iGXr-0PBt8aRRL7NyFUtyh7QbcVAEA2txEIgPH767q-5poLfM-yF1zp7XtDZrYXMdJy3cIDOZ4zJJWrOAL1D8AaWLGIsFHXY5l3-7ptc0QapTFh1OZP3rbvV-yR0TfXJyFTKrKg6F9ULVHN6XEcz7PNfzG-x5Ca6SXa36oY4d8siC7SYnLh5jY1iGbarfwer37BgUBIpXsGAjMyOuw7DU5JsmVC6vzq9mNkFgfn7xTNHFjOZunn605DzA9R4-B2Dgs2cOSXKZcJoV-C-IdoE_z4v_15wXI-IMq7XwtzArnLi256KayX_js";
const MQTT_TOPIC = 'joep/test';
const MQTT_CLIENT_ID = 'web1';

let mqttClient = null;

mqttClient = createMqttSubscribeClient(onMqttMessageRcv);

function createMqttSubscribeClient(onMessage) {

    console.info('EXMG MQTT:', 'connecting MQTT subscribe');

    const host = MQTT_HOST;
    const options = {
        keepalive: 10,
        protocolId: 'MQTT',
        protocolVersion: 4,
        clean: true,
        reconnectPeriod: 1000,
        connectTimeout: 30*1000,
        clientId: MQTT_CLIENT_ID
    };

    if (!window.mqtt) {
        throw new Error('`mqtt` is not defined in window scope');
    }

    const client = window.mqtt.connect(host, options);
    client.on('connect', function () {
        // TODO: handle/retry initial connection/sub failures
        client.subscribe(MQTT_TOPIC, function (err) {
            if (err) {
                console.error('EXMG MQTT:', 'subscribe error: ' + err);
            } else {
                console.info('EXMG MQTT:', 'subscribed');
            }
        });
    });
    client.on('message', function (topic, message) {
        onMessage(message.toString());
    });
    return client;
}

/*
// TODO: destroy client when player terminates session
function disposeMqttSubClient() {

}
*/

function onMqttMessageRcv(data) {
    console.log(data);
}

export {
    mqttClient
};
