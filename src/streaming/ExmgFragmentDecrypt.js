import ISOBoxer from 'codem-isoboxer';
import FactoryMaker from '../core/FactoryMaker';

ExmgFragmentDecrypt.__dashjs_factory_name = 'ExmgFragmentDecrypt';
export default FactoryMaker.getSingletonFactory(ExmgFragmentDecrypt);

function ExmgFragmentDecrypt(config) {
    let instance;

    const cipherMessages = [];
    const movInitDataHash = {}

    /**
     * @param {string} message
     */
    function onMqttMessage(message) {

        let messageObj;
        try {
            messageObj = JSON.parse(message);
            console.log('Parsed received cipher-msg:', messageObj);
        } catch (err) {
            console.error('Failed to parse as JSON:', message);
            console.error(err);
            return;
        }

        cipherMessages.push(messageObj);
    }

    /**
     *
     * @param {Uint8Array} data
     * @param {(Uint8Array) => void} onResult
     */
    function digestFragmentBuffer(data, onResult) {

        let parsedFile = ISOBoxer.parseBuffer(data);

        const mdhd = parsedFile.fetch('mdhd');
        const tkhd = parsedFile.fetch('tkhd');

        const moofs = parsedFile.fetchAll('moof');
        const trafs = parsedFile.fetchAll('traf');
        const mdats = parsedFile.fetchAll('mdat');

        if (tkhd) {
            movInitDataHash[tkhd.track_ID] = {
                timescale: mdhd.timescale
            };
            onResult(data);
            return;
        }

        if (trafs.length === 0) {
            onResult(data);
            return;
        }

        trafs.forEach((trafBox) => {
            const tfhd = trafBox.boxes[0];
            const tfdt = trafBox.boxes[1];
            const trackInfo = movInitDataHash[tfhd.track_ID];
            //console.log('first PTS:', tfdt.baseMediaDecodeTime, 'timescale:', trackInfo.timescale);
            const firstPtsSeconds = tfdt.baseMediaDecodeTime / trackInfo.timescale;
        });

        onResult(data);
    }

    /**
     *
     */
    function findCipherMessageByMediaTime(mediaTimeSecs) {
        let matchMsg = null;
        cipherMessages.forEach((msg) => {

        });
        return matchMsg;
    }

    const client = createExmgMqttSubscribeClient(onMqttMessage);

    instance = {
        client,
        digestFragmentBuffer
    }

    return instance;
}

function createExmgMqttSubscribeClient(onMessage) {

    console.log('EXMG MQTT:', 'connecting MQTT subscribe')

    var host = "wss://mqtt.liveryvideo.com?jwt=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyLWlkIjoid2ViMSIsImF1dGgtZ3JvdXBzIjoic3Vic2NyaWJlIn0.jovY0SCF9OZbsaj9Rx4yB8aN9QYxUNAOCd7m3TEkI49mu_3u1r3kqe27dOYOc1MrHOx0ezv2OQIYjum60mOTKr1W4jtNrXtpzAkheTu_j2pOffeKiz-8oNg-C99mvlXTad0XrRCiP30R_3UoKh7GzgwgWw0eJhr37RiyPILn-5R-cuVHZoh8ddWaQHyIYk2HfQQTAHtAdc56BHPWxiN196NpjYEnBitdBBG0CTpcxTula9kBS8vvek5Sdd3SMjAT3tGw0fX3RgHJMhbQYKxdpzz_Njnfh1f4MCJgFHZiu1O7obO-TmuiT-diWP4xD0JkryJ0a3rpqh61--Bt_3NDgVJzsKvg3JpHkOJtRAaR5keHAa5BRB_j1iGXr-0PBt8aRRL7NyFUtyh7QbcVAEA2txEIgPH767q-5poLfM-yF1zp7XtDZrYXMdJy3cIDOZ4zJJWrOAL1D8AaWLGIsFHXY5l3-7ptc0QapTFh1OZP3rbvV-yR0TfXJyFTKrKg6F9ULVHN6XEcz7PNfzG-x5Ca6SXa36oY4d8siC7SYnLh5jY1iGbarfwer37BgUBIpXsGAjMyOuw7DU5JsmVC6vzq9mNkFgfn7xTNHFjOZunn605DzA9R4-B2Dgs2cOSXKZcJoV-C-IdoE_z4v_15wXI-IMq7XwtzArnLi256KayX_js";

    var options = {
        keepalive: 10,
        protocolId: 'MQTT',
        protocolVersion: 4,
        clean: true,
        reconnectPeriod: 1000,
        connectTimeout: 30*1000,
        clientId: 'web1'
    };
    var client = mqtt.connect(host, options);

    client.on('connect', function () {
        client.subscribe('joep/test', function (err) {
            if (err)
                console.error('EXMG MQTT:', 'subscribe error: ' + err);
            else
                console.log('EXMG MQTT:', 'subscribed');
        });
    });


    client.on('message', function (topic, message) {
        //console.log('EXMG MQTT:', message.toString());
        onMessage(message.toString());
    });

    return client;
}

/**
 * @param {Uint8Array} cipherData
 * @param {Uint8Array} key
 * @param {Uint8Array} iv
 * @param {(Uint8Array) => void} onDecrypted
 */
function decryptAesCtr(cipherData, key, iv, onDecrypted) {

    if (!window.crypto) {
        throw new Error('WebCrypto API not available');
    }

    window.crypto.subtle.decrypt(
        {
            name: "AES-CTR",
            counter: iv,
            length: 64, // we use an 8-byte IV
        },
        key,
        cipherData
    )
    .then(function(clearData){
        onDecrypted(new Uint8Array(clearData));
    })
    .catch(function(err){
        throw new Error('Error decrypting AES-CTR cipherdata: ' + err.message);
    });
}
