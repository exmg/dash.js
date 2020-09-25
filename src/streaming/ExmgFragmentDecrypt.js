import ISOBoxer from 'codem-isoboxer';
import FactoryMaker from '../core/FactoryMaker';
import Events from '../core/events/Events';
import EventBus from './../core/EventBus';
import Settings from './../core/Settings';

ExmgFragmentDecrypt.__dashjs_factory_name = 'ExmgFragmentDecrypt';
export default FactoryMaker.getSingletonFactory(ExmgFragmentDecrypt);

import {mqttClient} from './ExmgMqttSubscribe';

const DEBUG = false;
const log = DEBUG ? console.log : () => void 0;

/**
 * @param {Uint8Array} cipherData Encrypted data buffer
 * @param {Uint8Array} key 16-bytes (128 bits) key
 * @param {Uint8Array} iv 8 bytes (64 bits) IV zero-padded in start of 16-bytes buffer
 * @returns {Promise<Uint8Array>}
 */
function decryptBufferFromAesCtr(cipherData, key, iv) {

    if (key.byteLength !== 16) throw new Error('Key must be 128 bits');
    if (iv.byteLength !== 16) throw new Error('8-bytes IV must be padded in 128 bits CTR data');

    const crypto = window.crypto;
    if (!crypto || !crypto.subtle) {
        throw new Error('WebCrypto (Subtle) API not available');
    }
    const algoId = 'AES-CTR';
    return crypto.subtle.importKey(
        'raw',
        key,
        algoId,
        false,
        ['decrypt']
    ).then((keyObj) => {
        return crypto.subtle.decrypt(
            {
                name: algoId,
                counter: iv,
                length: 64 // we use an 8-byte IV
            },
            keyObj,
            cipherData
        )
        .then((clearData) => {
            return new Uint8Array(clearData);
        })
        .catch((err) => {
            console.error('Error decrypting AES-CTR cipherdata: ' + err.message);
        });
    });
}

function ExmgFragmentDecrypt(config) {

    console.info('Creating ExmgFragmentDecrypt instance');

    const context = this.context;

    const _eventBus = EventBus(context).getInstance();

    config = config || {};

    let instance;
    let keyFilesBaseUrl;
    let keyFilesCustomExt;
    let keyIndexUpdateInterval = null;
    let keyUpdateIntervalMs;

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

        if (keyIndexUpdateInterval !== null) return; // singleton, we only do this once!

        keyFilesBaseUrl = Settings(context).getInstance().get().streaming.exmg.keyFilesBaseUrl;
        if (!keyFilesBaseUrl) {
            throw new Error('Need `streaming.exmg.keyFilesBaseUrl` property in settings!');
        }

        keyFilesCustomExt = Settings(context).getInstance().get().streaming.exmg.keyFilesCustomExt;
        if (!keyFilesCustomExt) {
            keyFilesCustomExt = '';
        }

        keyUpdateIntervalMs = Settings(context).getInstance().get().streaming.exmg.keyUpdateIntervalMs;

        keyIndexUpdateInterval = setInterval(updateKeys, keyUpdateIntervalMs);

        updateKeys(); // run once immediately on init
    }

    // may be called multiple times on disposal
    function deinit() {
        clearInterval(keyIndexUpdateInterval);
        keyIndexUpdateInterval = null;
    }

    function fetchKeyMessageUrl(url) {
        return new Promise((resolve, reject) => {
            fetch(url).then((res) => res.ok && res.text())
                .then((message) => {
                    if (!message) {
                        reject(null);
                        return;
                    }
                    //log('Received messsage:', JSON.parse(message));
                    resolve(message);
                })
                .catch((err) => {
                    console.error('Fatal error fetching key-message:', err);
                    reject(err);
                });
        });
    }

    function fetchKeyIndex(keyFilesBaseUrl, codecType, retries = 3) {
        const url = keyFilesBaseUrl + '/exmg_key_index_' + codecType + keyFilesCustomExt;
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

    function updateKeys() {
        if (!updateKeysOn) return;
        fetchKeyIndex(keyFilesBaseUrl, 'audio').then((index) => {
            audioKeyIndex = extractKeyIndexUrls(index);
            fetchKeysOnIndexUpdated('audio', audioKeyStartTime);
        });
        fetchKeyIndex(keyFilesBaseUrl, 'video').then((index) => {
            videoKeyIndex = extractKeyIndexUrls(index);
            fetchKeysOnIndexUpdated('video', videoKeyStartTime);
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
            fetchKeyMessageUrl(keyFilesBaseUrl + '/' + url + keyFilesCustomExt)
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
        case 'audio':
            fetchAndMapKeys(audioKeyIndex, audioKeyMap, fromTime);
            break;
        case 'video':
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

        // may fail if JSON message data is broken
        try {
            messageObj = JSON.parse(message);
            //console.debug('Parsed received cipher message:', messageObj);
        } catch (err) {
            console.error('Failed to parse JSON:', message);
            console.error(err);
            return;
        }

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
                console.debug(`Received very first cipher message for track ${mediaType}_${trackId} at ${mediaTimeSecs} secs`);
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
                type = 'video';
            } else if (tkhd.volume > 0 && tkhd.width === 0 && tkhd.height === 0) {
                type = 'audio';
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
            console.debug(parsedFile);
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
            case 'audio':
                audioKeyStartTime = firstPts;
                break;
            case 'video':
                videoKeyStartTime = firstPts;
                break;
            }

            // start updating keys once key-start-time is first set
            if (!updateKeysOn) {
                updateKeysOn = true;
                updateKeys();
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

            log('Short key/IV:',
                cipherMessageForBuffer.key, keyShort,
                cipherMessageForBuffer.iv, ivShort);

            const key = new Uint8Array(16); // 16bytes = 128bit key
            const iv = new Uint8Array(16); // IV is 8 bytes itself, but counter (AES-CTR) or "full IV" is same size as key zero-padded

            const keyView = new DataView(key.buffer);
            const ivView = new DataView(iv.buffer);

            keyView.setUint32(0, keyParsed, true);
            ivView.setUint32(0, ivParsed, true);

            log('Key/IV:', key, iv);

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
                log('Copying back into digest data clear bytes:', clearMdatPayload.byteLength, mdats[index].size - 8);
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
            //console.debug(JSON.stringify(cipherMessages));
        } else {
            console.debug('FOUND matching cipher-message for lookup-PTS:', firstPts, '| type:', trackType, '| key:', matchMsg.key);
            log(matchMsg);
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
