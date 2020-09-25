'use strict';

let bufferPlayableLength = 0;
let bufferUntilAudio = 0;
let bufferUntilVideo = 0;
let fragmentsLoadedAudio = 0;
let fragmentsLoadedVideo = 0;

const keyRangeMaxSecs = [0, 0];

const audioFragmentsLoadAheadTrace = {
    x: [],
    y: [],
    type: 'scatter',
    name: 'Audio-Fragments loaded ahead [s]',
    line: {
        color: '#ff6600',
        width: 3
    }
}

const videoFragmentsLoadAheadTrace = {
    x: [],
    y: [],
    type: 'scatter',
    name: 'Video-Fragments loaded ahead [s]',
    line: {
        color: '#ff0066',
        width: 3
    }
}

const bufferDecryptedTrace = {
    x: [],
    y: [],
    type: 'scatter',
    name: 'Playable-Buffer (decrypted) [s]',
    line: {
        color: '#00FF00',
        width: 3
    }
}

const bufferLengthVideoTrace = {
    x: [],
    y: [],
    type: 'scatter',
    name: 'Loaded-Ahead Video (encrypted) [s]',
    line: {
        color: '#C00000',
        width: 3
    }
}

const bufferLengthAudioTrace = {
    x: [],
    y: [],
    type: 'scatter',
    name: 'Loaded-Ahead Audio (encrypted) [s]',
    line: {
        color: '#F00000',
        width: 3
    }
}

const keyScopeLoadedAudioTrace = {
    x: [],
    y: [],
    type: 'scatter',
    name: 'Loaded-Ahead Keys (audio) [s]',
    line: {
        color: '#0060B0',
        width: 3
    }
}

const keyScopeLoadedVideoTrace = {
    x: [],
    y: [],
    type: 'scatter',
    name: 'Loaded-Ahead Keys (video) [s]',
    line: {
        color: '#0000E0',
        width: 3
    }
}

const keyScopeAvailableTrace = {
    x: [],
    y: [],
    type: 'scatter',
    name: 'Available-Ahead Keys [s]'
}

const bufferGraphLayout = {
    //title:''
};

function updatePlots() {

    if (startTime === null) return;

    const time = (perf.now() - startTime) / 1000;

    bufferLengthAudioTrace.x.push(time);
    bufferLengthVideoTrace.x.push(time);
    bufferDecryptedTrace.x.push(time);
    keyScopeLoadedAudioTrace.x.push(time);
    keyScopeLoadedVideoTrace.x.push(time);
    keyScopeAvailableTrace.x.push(time);

    bufferDecryptedTrace.y.push(bufferPlayableLength);
    bufferLengthAudioTrace.y.push(Math.max(0, bufferUntilAudio - video.currentTime));
    bufferLengthVideoTrace.y.push(Math.max(0, bufferUntilVideo - video.currentTime));
    keyScopeLoadedAudioTrace.y.push(Math.max(0, keyRangeMaxSecs[0] - video.currentTime));
    keyScopeLoadedVideoTrace.y.push(Math.max(0, keyRangeMaxSecs[1] - video.currentTime));
    keyScopeAvailableTrace.y.push(0);

    const data = [
        //keyScopeAvailableTrace,
        keyScopeLoadedAudioTrace,
        keyScopeLoadedVideoTrace,
        bufferLengthAudioTrace,
        bufferLengthVideoTrace,
        bufferDecryptedTrace,
    ];

    Plotly.newPlot('buffer-graph', data, bufferGraphLayout);
}
