import ISOBoxer from 'codem-isoboxer';
import FactoryMaker from '../core/FactoryMaker';
import Events from '../core/events/Events';
import EventBus from './../core/EventBus';
import Settings from './../core/Settings';

ExmgFragmentDecrypt.__dashjs_factory_name = 'ExmgFragmentDecrypt';
export default FactoryMaker.getSingletonFactory(ExmgFragmentDecrypt);

import {getSingletonMqttClient} from './ExmgMqttSubscribe';
import {decryptBufferFromAesCtr} from './ExmgCrypto';
import {getConsoleFunc} from './ExmgConsole';

const DEBUG = true;
const VERBOSE = false;

const USE_MQTT_KEY_TRANSPORT = true;

const log = getConsoleFunc(DEBUG, 'exmg-fragment-decrypt');
const debug = getConsoleFunc(DEBUG && VERBOSE, 'exmg-fragment-decrypt', 'debug');

const MediaType = {
    AUDIO: 'audio',
    VIDEO: 'video'
};

function ExmgFragmentDecrypt(config) {

    log('Creating ExmgFragmentDecrypt instance');

    const context = this.context;
    const _eventBus = EventBus(context).getInstance();

    config = config || {};

    let instance;
    let keyFilesHttpBaseUrl;
    let keyFilesHttpCustomExt;
    let keyIndexUpdateHttpInterval = null;
    let keyUpdateHttpIntervalMs;

    let audioKeyIndex = null;
    let videoKeyIndex = null;

    let audioKeyStartTime = 0;
    let videoKeyStartTime = 0;

    let updateKeysOn = false;

    const audioKeyMap = {};
    const videoKeyMap = {};
    const cipherMessageHash = {};
    const movInitDataHash = {};
    const perf = window.performance;

    function init() {

        if (keyIndexUpdateHttpInterval !== null) {
            console.warn('Singleton init already called');
            return; // singleton, we only do this once!
        }

        keyFilesHttpBaseUrl = Settings(context).getInstance().get().streaming.exmg.keyFilesBaseUrl;
        if (!keyFilesHttpBaseUrl) {
            throw new Error('Need `streaming.exmg.keyFilesBaseUrl` property in settings!');
        }

        keyFilesHttpCustomExt = Settings(context).getInstance().get().streaming.exmg.keyFilesCustomExt;
        if (!keyFilesHttpCustomExt) {
            keyFilesHttpCustomExt = '';
        }

        keyUpdateHttpIntervalMs = Settings(context).getInstance().get().streaming.exmg.keyUpdateIntervalMs;

        keyIndexUpdateHttpInterval = setInterval(updateKeysFromHttp, keyUpdateHttpIntervalMs);
        updateKeysFromHttp(); // run once immediately on init

        if (USE_MQTT_KEY_TRANSPORT) {

            const mqttConfig = Settings(context).getInstance().get().streaming.exmg.mqtt;
            getSingletonMqttClient(mqttConfig).on('message', (_topic, messageBuf) => {
                const message = messageBuf.toString();
                onCipherMessage(message.substr(0, message.length - 1));
            });
        }

    }

    // may be called multiple times on disposal
    function deinit() {
        clearInterval(keyIndexUpdateHttpInterval);
        keyIndexUpdateHttpInterval = null;
    }

    function fetchKeyMessageUrl(url) {
        return new Promise((resolve, reject) => {
            fetch(url).then((res) => res.ok && res.text())
                .then((message) => {
                    if (!message) {
                        reject(null);
                        return;
                    }
                    resolve(message);
                })
                .catch((err) => {
                    console.error('Fatal error fetching key-message:', err);
                    reject(err);
                });
        });
    }

    function fetchKeyIndex(keyFilesBaseUrl, codecType, retries = 3) {
        const url = keyFilesBaseUrl + '/exmg_key_index_' + codecType + keyFilesHttpCustomExt;
        return fetch(url)
            .then((response) => {
                if (response.ok) {
                    return response.text();
                } else {
                    if (retries >= 0) {
                        console.warn('Retrial attempts for fetching key-index. Counter:', retries);
                        return fetchKeyIndex(keyFilesBaseUrl, codecType, --retries);
                    } else {
                        return null;
                    }
                }
            });
    }

    function updateKeysFromHttp() {
        if (USE_MQTT_KEY_TRANSPORT) return;
        if (!updateKeysOn) return;
        fetchKeyIndex(keyFilesHttpBaseUrl, MediaType.AUDIO).then((index) => {
            audioKeyIndex = extractKeyIndexUrls(index);
            fetchKeysOnIndexUpdated(MediaType.AUDIO, audioKeyStartTime);
        });
        fetchKeyIndex(keyFilesHttpBaseUrl, MediaType.VIDEO).then((index) => {
            videoKeyIndex = extractKeyIndexUrls(index);
            fetchKeysOnIndexUpdated(MediaType.VIDEO, videoKeyStartTime);
        });
    }

    /**
     * @typedef {Array} KeyIndexEntry // {[number, string]} KeyIndexEntry
     * @param {string} keyIndexData
     * @returns {Array<KeyIndexEntry>}
     */
    function extractKeyIndexUrls(keyIndexData) {
        if (!keyIndexData) {
            console.error('No key index data received');
            return;
        }
        return keyIndexData.split('\n')
            .map((url) => url.substr(url.lastIndexOf('/') + 1))
            .filter((url) => !!url.length)
            .map((url) => {
                try {
                    const time = url.split('.')[0].split('_')[4];
                    return [time, url];
                } catch (err) {
                    throw new Error('Key-index URL must be malformed: ' + url);
                }
            });
    }

    /**
     * @param {Array<KeyIndexEntry>} index
     * @param {*} keyMap // {[url: string]: boolean}
     * @param {number} fromTime
     */
    function fetchAndMapKeys(index, keyMap, fromTime) {
        if (!index) return;
        index.forEach(([mediaTime, url]) => {
            if (mediaTime < fromTime) return;
            if (keyMap[url]) {
                return;
            }
            keyMap[url] = true; // mark as requested
            fetchKeyMessageUrl(keyFilesHttpBaseUrl + '/' + url + keyFilesHttpCustomExt)
                .then((message) => {
                    keyMap[url] = message; // store result
                    onCipherMessage(message);
                })
                .catch((err) => {
                    keyMap[url] = false; // mark as failed
                    console.warn('Failure to retrieve key!');
                    console.error(err);
                });
        });
    }

    function fetchKeysOnIndexUpdated(codecType, fromTime = 0) {
        switch (codecType) {
        case MediaType.AUDIO:
            fetchAndMapKeys(audioKeyIndex, audioKeyMap, fromTime);
            break;
        case MediaType.VIDEO:
            fetchAndMapKeys(videoKeyIndex, videoKeyMap, fromTime);
            break;
        }
    }

    function getOrCreateCipherMessagesForTrackId(id, type) {
        const hashKey = id + '_' + type;
        if (cipherMessageHash[hashKey]) {
            return cipherMessageHash[hashKey];
        } else {
            const cipherMessages = [];
            cipherMessageHash[hashKey] = cipherMessages;
            return cipherMessages;
        }
    }

    /**
     * @param {string} message
     */
    function onCipherMessage(message) {

        let messageObj;

        if (message === 'ping') return;

        // may fail if JSON message data is broken
        try {
            messageObj = JSON.parse(message);
        } catch (err) {
            console.error('Failed to parse JSON:', message);
            console.error(err);
            return;
        }

        log('Received message:', messageObj);

        try {

            const trackId = messageObj.fragment_info.track_id;
            const mediaType = messageObj.fragment_info.codec_type;
            const mediaTimeSecs = messageObj.fragment_info.media_time_secs;
            const keyDurationSecs = messageObj.fragment_info.duration / messageObj.fragment_info.timescale;

            const cipherMessages
                = getOrCreateCipherMessagesForTrackId(
                    messageObj.fragment_info.track_id,
                    messageObj.fragment_info.codec_type
                );

            log('Received key for', mediaType, 'media-time scope:', messageObj.fragment_info.media_time_secs);

            cipherMessages.push(messageObj);

            _eventBus.trigger(Events.EXMG_LIVE_SYNC_CIPHER_MESSAGE, {trackId, mediaType, mediaTimeSecs, keyDurationSecs});

            if (cipherMessages.length === 1) {
                debug(`Received very first cipher message for track ${mediaType}_${trackId} at ${mediaTimeSecs} secs`);
            }

        } catch (err) {
            console.error('Fatal error hashing received message:', err);
        }
    }

    function makeSegmentTypeHashkey(mediaType, trackId) {
        return mediaType + '_' + trackId;
    }

    /**
     *
     * @param {ArrayBuffer} data Fragment data loaded completely
     * @param {*} request Handle to dash.js loader request
     * @param {Function} onResult Loader "report" callback for this request
     * @param {FragmentLoader} loaderInstance Loader instance
     * @param {EventBus} eventBus Event-bus instance used by loader internally
     */
    function digestFragmentBuffer(data, request, onResult, loaderInstance, eventBus) {

        const {mediaType} = request;

        _eventBus.trigger(Events.EXMG_LIVE_SYNC_CIPHER_PAYLOAD, {request});

        // parse whole segment with ISO-FF
        let parsedFile = ISOBoxer.parseBuffer(data);

        // check for init data
        const tkhd = parsedFile.fetch('tkhd');
        if (tkhd) {

            // map useful track info to id
            let type;
            if (tkhd.volume === 0 && tkhd.width > 0 && tkhd.height > 0) {
                type = MediaType.VIDEO;
            } else if (tkhd.volume > 0 && tkhd.width === 0 && tkhd.height === 0) {
                type = MediaType.AUDIO;
            } else {
                throw new Error('Unable to recognize track type from `tkhd` atom');
                // FIXME: in case necessary, there are unambiguous solutions here
            }

            const timescale = parsedFile.fetch('mdhd').timescale;
            const id = tkhd.track_ID;

            movInitDataHash[makeSegmentTypeHashkey(type, id)] = {
                id,
                timescale,
                type
            };

            // return early, nothing more to do
            onResult(data);
            return;
        }

        // should be a (moof/mdat)s segment, check for traf boxes
        const trafs = parsedFile.fetchAll('traf');
        if (trafs.length === 0) {
            console.warn('Media segment was not init data but has no track fragments');
            console.warn(parsedFile);
            onResult(data);
            return;
        }

        let isKeyMissing = false;

        for (let index = 0; index < trafs.length; index++) {
            // get track fragment first PTS
            const trafBox = trafs[index];
            const tfhd = trafBox.boxes[0];
            const tfdt = trafBox.boxes[1];
            const trackId = tfhd.track_ID;
            const firstPts = tfdt.baseMediaDecodeTime;

            const trackInfo = movInitDataHash[makeSegmentTypeHashkey(mediaType, trackId)];

            switch (mediaType) {
            case MediaType.AUDIO:
                audioKeyStartTime = firstPts;
                break;
            case MediaType.VIDEO:
                videoKeyStartTime = firstPts;
                break;
            }

            // start updating keys once key-start-time is first set
            if (!updateKeysOn) {
                updateKeysOn = true;
                updateKeysFromHttp();
            }

            // lookup key
            const cipherMessageForBuffer = findCipherMessageByMediaTime(firstPts, trackInfo.id, trackInfo.type);
            if (!cipherMessageForBuffer) {
                isKeyMissing = true;
                break;
            }
        }

        if (!isKeyMissing) {

            _eventBus.trigger(Events.EXMG_LIVE_SYNC_CIPHER_DECRYPTING, {mediaType, url: request.url});

            decryptFragmentBuffer(data, parsedFile, mediaType, request.url, onResult);

        } else {
            const alertMsg = `Missing cipher-info for ${request.mediaType} segment (triggering RETRY via 'LOADING_ABANDONED'): ${request.url}`;
            console.warn(alertMsg);

            _eventBus.trigger(Events.EXMG_LIVE_SYNC_CIPHER_MISS, {mediaType, url: request.url});

            setTimeout(() => {
                eventBus.trigger(Events.LOADING_ABANDONED, {request, mediaType, sender: loaderInstance});
            }, request.duration * 1000); // duration of fragment in seconds
        }
    }

    /**
     *
     * @param {ArrayBuffer} data
     * @param {ISOBoxerFile} parsedFile
     * @param {string} mediaType
     * @param {string} url
     * @param {Function} onResult
     */
    function decryptFragmentBuffer(data, parsedFile, mediaType, url, onResult) {
        const now = perf.now();

        // retrieve all trafs & mdats, lookup key-message by baseMediaDecodeTime
        // and decrypt the payload

        const mdats = parsedFile.fetchAll('mdat');
        const trafs = parsedFile.fetchAll('traf');

        const clearBufferPromises = [];

        //const cipherMessages = new Set();

        for (let index = 0; index < trafs.length; index++) {
            const trafBox = trafs[index];
            const tfhd = trafBox.boxes[0];
            const tfdt = trafBox.boxes[1];

            const trackId = tfhd.track_ID;
            const firstPts = tfdt.baseMediaDecodeTime;
            const trackInfo = movInitDataHash[makeSegmentTypeHashkey(mediaType, trackId)];

            const cipherMessageForBuffer = findCipherMessageByMediaTime(firstPts, trackInfo.id, trackInfo.type);

            //cipherMessages.add(cipherMessageForBuffer);

            // create full key data from short keys
            const keyParsed = parseInt(cipherMessageForBuffer.key);
            const ivParsed = parseInt(cipherMessageForBuffer.iv);
            if (isNaN(keyParsed) || isNaN(ivParsed)) {
                throw new Error('Key or IV have wrong format (should be serialized as integer numbers)');
            }

            const keyShort = new Uint32Array([keyParsed]);
            const ivShort = new Uint32Array([ivParsed]);

            debug('Short key/IV:',
                cipherMessageForBuffer.key, keyShort,
                cipherMessageForBuffer.iv, ivShort);

            const key = new Uint8Array(16); // 16bytes = 128bit key
            const iv = new Uint8Array(16); // IV is 8 bytes itself, but counter (AES-CTR) or "full IV" is same size as key zero-padded

            const keyView = new DataView(key.buffer);
            const ivView = new DataView(iv.buffer);

            keyView.setUint32(0, keyParsed, true);
            ivView.setUint32(0, ivParsed, true);

            debug('Key/IV:', key, iv);

            // decrypt the mdat buffer
            const mdat = mdats[index];
            clearBufferPromises.push(decryptBufferFromAesCtr(mdat.data, key, iv));
        }

        // awaiting all decrypt promise results ...
        Promise.all(clearBufferPromises).then((clearBuffers) => {
            const digestDataBuffer = new Uint8Array(data);
            const decryptTimeMs = perf.now() - now;
            log(`Decrypted ${clearBuffers.length} fragment buffers in ${decryptTimeMs.toFixed(3)} ms`);
            clearBuffers.forEach((clearMdatPayload, index) => {
                debug('Copying back into digest data clear bytes:',
                    clearMdatPayload.byteLength, mdats[index].size - 8);
                const mdatDataOffset = mdats[index]._offset + 8;
                digestDataBuffer.set(clearMdatPayload, mdatDataOffset);
            });
            onResult(digestDataBuffer.buffer);
            _eventBus.trigger(Events.EXMG_LIVE_SYNC_CIPHER_DECRYPTED, {mediaType, url /*, cipherMessages */});
        });
    }

    function findCipherMessageByMediaTime(firstPts, trackId, trackType) {

        const cipherMessages = getOrCreateCipherMessagesForTrackId(trackId, trackType);

        let matchMsg = null;
        for (let index = 0; index < cipherMessages.length; index++) {
            const msg = cipherMessages[index];
            try {
                const keyFirstPts = msg.fragment_info.first_pts; // corresponds to first PTS for that key
                const keyDuration = msg.fragment_info.duration;
                const keyBoundaryPts = keyFirstPts + keyDuration;
                if (firstPts >= keyFirstPts && firstPts < keyBoundaryPts) {
                    matchMsg = msg;
                    break;
                }
            } catch (err) {
                console.error('Error accessing cipher-message data:', err.message);
            }
        }
        if (!matchMsg) {
            console.warn('NOT-FOUND matching cipher-message for lookup-PTS:', firstPts, '| type:', trackType);
        } else {
            debug('FOUND matching cipher-message for lookup-PTS:', firstPts, '| type:', trackType, '| key:', matchMsg.key);
            debug(matchMsg);
        }
        return matchMsg;
    }

    instance = {
        digestFragmentBuffer,
        init,
        deinit,
        eventBus: _eventBus
    };

    return instance;
}
