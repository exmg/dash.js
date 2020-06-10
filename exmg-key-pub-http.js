#!/usr/bin/env node

const fs = require('fs');
const http = require('http')
const https = require('https')
const path = require('path')

const phin = require('phin')

const remoteStreamId = 664379;
const remoteEventName = 'stephan'

const remoteHost = `p-ep${remoteStreamId}.i.akamaientrypoint.net`;
const remoteBasePath = `/cmaf/${remoteStreamId}/${remoteEventName}/`;

const dirPath = path.resolve(process.argv[2]);
if (!dirPath) {
    throw new Error('Need to specify a key-file source directory');
}

const subFolder = process.argv[3];
if (!subFolder) {
    throw new Error('Need to specify a sub-folder parameter for remote path construction')
}

const JOB_POLL_MS = 1000;

const PUB_LOCK_FILE_EXT = '.lock';

function doHttpPost(hostname, path, data, mimeType) {

    const url =  'http://' + hostname + path;
    const phinOpts = {
        url,
        method: 'POST',
        data: data.toString('utf8'), // Q
        core: {
            headers: {
                'Connection': 'keep-alive',
                'Accept': '*/*',
                'User-Agent': 'Akamai_Broadcaster_v1.0',
                'Icy-MetaData': '1',
                'Content-Type': mimeType
            }
        }
    }

    console.log('Doing HTTP-request:', phinOpts);

    return phin(phinOpts)
}

function getDirFilesListing(dir) {
    return new Promise((resolve, reject) => {
        // list all files in the directory
        fs.readdir(dir, (err, files) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(files)
        });
    })
}

function readFile(path) {
    return new Promise((res, rej) => {
        fs.readFile(path, (err, buf) => {
            if (err) {
                rej(err);
                return;
            }
            res(buf);
        })
    })
}

function writeLockFile(path) {
    return new Promise((res, rej) => {
        fs.writeFile(path + PUB_LOCK_FILE_EXT, null, res);
    });
}

function scanAndPublish() {
    let filesList;

    return getDirFilesListing(dirPath).then((files) => {

        console.log('Scanned files in dir:', files)

        // Exclude all files that have a PUB_LOCK_FILE_EXT
        // and add the prequel to the current lock-set,
        // then filter all actual non-lock files through the lock-set.
        // (coherent within one scan-run)
        const lockSet = new Set();
        filesList = files = files.filter((f) => {
            if(f.endsWith(PUB_LOCK_FILE_EXT)) {
                lockSet.add(f.substr(0, f.length - 5));
                return false;
            }
            return true;
        }).filter((f) => !lockSet.has(f));

        console.log('Non pub-lock`d files found:', filesList);

        return Promise.all(files.map((filename, index) => {
            console.log('reading file:', filename)
            return readFile(path.join(dirPath, filename))
        }));

    }).then((bufferList) => {
        console.log('Read buffers:', bufferList.length)
        return Promise.all(bufferList.map((buf, index) => {

            const filename = filesList[index];
            const remoteFilePath = remoteBasePath + subFolder + '/' + filename;

            const mimeType = filename.endsWith('.json') ? 'application/json' : 'text/plain';

            //const mimeType = 'video/mp4';

            return doHttpPost(remoteHost, remoteFilePath, buf, mimeType)
                .then((res) => {
                    console.log('Done POST:', res.url)
                    console.log('Server response:', res.body.toString('utf8'))

                    if (res.statusCode >= 400) {
                        throw new Error(`HTTP-response status: ${res.statusMessage} (${res.statusCode}) (${remoteFilePath})`);
                    }
                })
                .then(() => writeLockFile(path.resolve(dirPath, filename)))
        }))
    })
}

(function main() {

    /*
    let idle = true;
    setInterval(() => {
        // check for async lock
        if (!idle) return;
        idle = false;

        scanAndPublish().then(() => {
            idle = true;
            scanAndPublish();
        }).catch((err) => {
            console.error('[EXMG KEY-PUB] Caught fatal:', err);
            process.exit(1);
        })

    }, JOB_POLL_MS)
    */

   scanAndPublish().then(() => {
        scanAndPublish();
    }).catch((err) => {
        console.error('[EXMG KEY-PUB] Caught fatal:', err);
        process.exit(1);
    })

})();
