/**
 * This file is part of Adguard Browser Extension (https://github.com/AdguardTeam/AdguardBrowserExtension).
 *
 * Adguard Browser Extension is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Adguard Browser Extension is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Adguard Browser Extension.  If not, see <http://www.gnu.org/licenses/>.
 */

var Log = require('utils/log').Log;
var SafariContentBlockerConverter = require('converter').SafariContentBlockerConverter;

/**
 * Safari Content Blocker helper
 */
var SafariContentBlocker = exports.SafariContentBlocker = {
    emptyBlockerUrl: 'config/empty.json',

    /**
     * Loads array of rules to content blocker
     *
     * @param rules
     */
    loadFilters: function (rules) {
        Log.info('Starting loading content blocker.');

        var converted = SafariContentBlockerConverter.convertArray(rules, 50000);

        this._setContentBlocker(JSON.parse(converted.converted));
    },

    /**
     * Disables content blocker
     */
    clearFilters: function () {
        Log.info('Disabling content blocker.');
        this._loadUrl(this.emptyBlockerUrl, this._setContentBlocker);
    },

    _loadUrl: function (url, onSuccess) {
        Log.info('Loading ' + url);
        var xhr = new XMLHttpRequest();
        try {
            xhr.onreadystatechange = function () {
                if (xhr.readyState != 4) {
                    return;
                }

                var responseText = xhr.responseText;
                Log.info('Successfully loaded ' + url + '. Length=' + responseText.length);

                if (xhr.responseText) {
                    onSuccess(xhr.responseText);
                }
            };

            xhr.onerror = function (error) {
                Log.error('Error while loading ' + url + ': ' + error);
            };

            xhr.open("GET", url, true);
            xhr.send(null);
        } catch (e) {
            Log.error('Error while starting load of ' + url + ': ' + e);
        }
    },

    _setContentBlocker: function (json) {
        try {
            Log.info('Setting content blocker. Length=' + json.length);
            var result = safari.extension.setContentBlocker(json);
            Log.info('Content blocker has been set.');
        } catch (ex) {
            Log.error('Error while setting content blocker: ' + ex);
        }
    }
};