/**
 * The copyright in this software is being made available under the BSD License,
 * included below. This software may be subject to other third party and contributor
 * rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2013, Dash Industry Forum.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *  * Redistributions of source code must retain the above copyright notice, this
 *  list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *  this list of conditions and the following disclaimer in the documentation and/or
 *  other materials provided with the distribution.
 *  * Neither the name of Dash Industry Forum nor the names of its
 *  contributors may be used to endorse or promote products derived from this software
 *  without specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS AS IS AND ANY
 *  EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 *  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 *  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 *  INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 *  NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 *  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 *  WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
 */
import HTTPLoader from './net/HTTPLoader';
import HeadRequest from './vo/HeadRequest';
import DashJSError from './vo/DashJSError';
import EventBus from './../core/EventBus';
import BoxParser from '../streaming/utils/BoxParser';
import Events from './../core/events/Events';
import Errors from './../core/errors/Errors';
import FactoryMaker from '../core/FactoryMaker';

function FragmentLoader(config) {

    config = config || {};
    const context = this.context;
    const eventBus = EventBus(context).getInstance();

    let instance,
        httpLoader;

    function setup() {
        const boxParser = BoxParser(context).getInstance();
        httpLoader = HTTPLoader(context).create({
            errHandler: config.errHandler,
            dashMetrics: config.dashMetrics,
            mediaPlayerModel: config.mediaPlayerModel,
            requestModifier: config.requestModifier,
            boxParser: boxParser,
            useFetch: config.settings.get().streaming.lowLatencyEnabled
        });
    }

    function checkForExistence(request) {
        const report = function (success) {
            eventBus.trigger(
                Events.CHECK_FOR_EXISTENCE_COMPLETED, {
                    request: request,
                    exists: success
                }
            );
        };

        if (request) {
            let headRequest = new HeadRequest(request.url);

            httpLoader.load({
                request: headRequest,
                success: function () {
                    report(true);
                },
                error: function () {
                    report(false);
                }
            });
        } else {
            report(false);
        }
    }

    function load(request) {
        const report = function (data, error) {
            eventBus.trigger(Events.LOADING_COMPLETED, {
                request: request,
                response: data || null,
                error: error || null,
                sender: instance
            });
        };

        if (request) {
            httpLoader.load({
                request: request,
                progress: function (event) {
                    eventBus.trigger(Events.LOADING_PROGRESS, {
                        request: request,
                        stream: event.stream
                    });
                    if (event.data) {
                        eventBus.trigger(Events.LOADING_DATA_PROGRESS, {
                            request: request,
                            response: event.data || null,
                            error: null,
                            sender: instance
                        });
                    }
                },
                success: function (data) {
                    report(data);
                },
                error: function (request, statusText, errorText) {
                    report(
                        undefined,
                        new DashJSError(
                            Errors.FRAGMENT_LOADER_LOADING_FAILURE_ERROR_CODE,
                            errorText,
                            statusText
                        )
                    );
                },
                abort: function (request) {
                    if (request) {
                        eventBus.trigger(Events.LOADING_ABANDONED, {request: request, mediaType: request.mediaType, sender: instance});
                    }
                }
            });
        } else {
            report(
                undefined,
                new DashJSError(
                    Errors.FRAGMENT_LOADER_NULL_REQUEST_ERROR_CODE,
                    Errors.FRAGMENT_LOADER_NULL_REQUEST_ERROR_MESSAGE
                )
            );
        }
    }

    function abort() {
        if (httpLoader) {
            httpLoader.abort();
        }
    }

    function reset() {
        if (httpLoader) {
            httpLoader.abort();
            httpLoader = null;
        }
    }

    instance = {
        checkForExistence: checkForExistence,
        load: load,
        abort: abort,
        reset: reset
    };

    setup();

    return instance;
}

FragmentLoader.__dashjs_factory_name = 'FragmentLoader';
export default FactoryMaker.getClassFactory(FragmentLoader);

// private EXMG
// TODO: move this function and its config to an own JS module
// (external plugin, overloading FragmentLoader properly)
function setupExmgMqttSubscribe() {

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
        console.log('EXMG MQTT:', message.toString());
    });
}

setupExmgMqttSubscribe();
