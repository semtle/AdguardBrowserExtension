/**
 * Safari content blocking format rules converter.
 */
var CONVERTER_VERSION = '1.2.0';
// Max number of CSS selectors per rule (look at _compactCssRules function)
var MAX_SELECTORS_PER_WIDE_RULE = 250;
var URL_FILTER_ANY_URL = ".*";

var punycode = require("punycode");

var FilterRule = require('filter/rules/base-filter-rule').FilterRule;
var CssFilterRule = require('filter/rules/css-filter-rule').CssFilterRule;
var UrlFilterRule = require('filter/rules//url-filter-rule').UrlFilterRule;
var ScriptFilterRule = require('filter/rules//script-filter-rule').ScriptFilterRule;
var StringUtils = require('utils/common').StringUtils;
var Log = require('utils/log').Log;
var UrlUtils = require('utils/url').UrlUtils;

exports.SafariContentBlockerConverter = {

    AGRuleConverter: {

        _parseDomains: function (rule, included, excluded) {
            if (rule.permittedDomain) {
                var domain = punycode.toASCII(rule.permittedDomain.toLowerCase());
                included.push(domain);
            } else if (rule.permittedDomains) {
                var domains = rule.permittedDomains;
                for (var i in domains) {
                    if (domains[i] != "") {
                        var domain = domains[i];
                        domain = punycode.toASCII(domain.toLowerCase());

                        included.push(domain);
                    }
                }
            }

            if (rule.restrictedDomain) {
                var domain = punycode.toASCII(rule.restrictedDomain.toLowerCase());
                excluded.push(domain);
            } else if (rule.restrictedDomains) {
                var domains = rule.restrictedDomains;
                for (var i in domains) {
                    var domain = domains[i];
                    if (domain) {
                        domain = punycode.toASCII(domain.toLowerCase());
                        excluded.push(domain);
                    }
                }
            }

        },

        _addThirdParty: function (trigger, rule) {
            if (rule.isThirdParty != null && rule.isThirdParty) {
                trigger["load-type"] = ["third-party"];
            }
        },

        _addMatchCase: function (trigger, rule) {
            if (rule.matchCase != null && rule.matchCase) {
                trigger["url-filter-is-case-sensitive"] = true;
            }
        },

        _writeDomainOptions: function (included, excluded, trigger) {
            if (included.length > 0 && excluded.length > 0) {
                throw new Error('Safari does not support both permitted and restricted domains');
            }

            if (included.length > 0)
                trigger["if-domain"] = included;
            if (excluded.length > 0)
                trigger["unless-domain"] = excluded;
        },

        _addDomainOptions: function (trigger, rule) {
            var included = [];
            var excluded = [];
            this._parseDomains(rule, included, excluded);
            this._writeDomainOptions(included, excluded, trigger);
        },

        _setWhiteList: function (rule, result) {
            if (rule.whiteListRule && rule.whiteListRule === true) {
                result.action.type = "ignore-previous-rules";
            }
        },

        _addResourceType: function (rule, result) {
            var types = [];

            if (rule.permittedContentType == 255) {
                // Safari does not support all other default content types, like subdocument etc.
                // So we can use default safari content types instead.
                return;
            }

            if (rule.permittedContentType & getClasses().UrlFilterRule.contentTypes.IMAGE)
                types.push("image");
            if (rule.permittedContentType & getClasses().UrlFilterRule.contentTypes.STYLESHEET)
                types.push("style-sheet");
            if (rule.permittedContentType & getClasses().UrlFilterRule.contentTypes.SCRIPT)
                types.push("script");
            if (rule.permittedContentType & getClasses().UrlFilterRule.contentTypes.MEDIA)
                types.push("media");
            if (rule.permittedContentType & getClasses().UrlFilterRule.contentTypes.POPUP)
                types.push("popup");
            if (rule.permittedContentType & (getClasses().UrlFilterRule.contentTypes.XMLHTTPREQUEST | getClasses().UrlFilterRule.contentTypes.OTHER))
                types.push("raw");
            if (rule.permittedContentType & getClasses().UrlFilterRule.contentTypes.FONT)
                types.push("font");

            //Use document for subdocument
            if (rule.permittedContentType == getClasses().UrlFilterRule.contentTypes.SUBDOCUMENT)
                types.push("document");

            //Not supported modificators
            if (rule.permittedContentType == getClasses().UrlFilterRule.contentTypes.OBJECT) {
                throw new Error('Object content type is not yet supported');
            }
            if (rule.permittedContentType == getClasses().UrlFilterRule.contentTypes['OBJECT-SUBREQUEST']) {
                throw new Error('Object_subrequest content type is not yet supported');
            }

            if (rule.permittedContentType == (getClasses().UrlFilterRule.contentTypes.JSINJECT | getClasses().UrlFilterRule.contentTypes.ALL)) {
                throw new Error('$jsinject rules are ignored.');
            }


            if (types.length > 0) {
                result.trigger["resource-type"] = types;
            }

            //TODO: Add restricted content types?

        },

        _createUrlFilterString: function (filter) {
            if (filter.urlRegExp) {
                return filter.urlRegExp.source;
            }

            if (filter.getUrlRegExpSource) {
                var urlRegExpSource = filter.getUrlRegExpSource();
                if (urlRegExpSource && urlRegExpSource != "") {
                    return urlRegExpSource;
                }

            }

            return filter.ruleText;
        },

        _parseRuleDomain: function (ruleText) {
            try {
                var i;
                var startsWith = ["http://www.", "https://www.", "http://", "https://", "||", "//"];
                var contains = ["/", "^"];
                var startIndex = 0;

                for (i = 0; i < startsWith.length; i++) {
                    var start = startsWith[i];
                    if (StringUtils.startWith(ruleText, start)) {
                        startIndex = start.length;
                        break;
                    }
                }

                //exclusive for domain
                var exceptRule = "domain=";
                var domainIndex = ruleText.indexOf(exceptRule);
                if (domainIndex > -1 && ruleText.indexOf("$") > -1) {
                    startIndex = domainIndex + exceptRule.length;
                }

                if (startIndex == -1) {
                    return "";
                }

                var symbolIndex = -1;
                for (i = 0; i < contains.length; i++) {
                    var contain = contains[i];
                    var index = ruleText.indexOf(contain, startIndex);
                    if (index >= 0) {
                        symbolIndex = index;
                        break
                    }
                }

                var domain = symbolIndex == -1 ? ruleText.substring(startIndex) : ruleText.substring(startIndex, symbolIndex);
                var path = symbolIndex == -1 ? null : ruleText.substring(symbolIndex);

                return {
                    domain: UrlUtils.toPunyCode(domain),
                    path: path
                }

            } catch (ex) {
                Log.error("Error parsing domain from {0}, cause {1}", ruleText, ex);
                return null;
            }
        },

        convertCssFilterRule: function (rule) {

            if (rule.isInjectRule && rule.isInjectRule == true) {
                // There is no way to convert these rules to safari format
                throw new Error("Css-injection rule " + rule.ruleText + " cannot be converted");
            }

            var result = {
                trigger: {
                    "url-filter": URL_FILTER_ANY_URL
                },
                action: {
                    type: "css-display-none",
                    selector: rule.cssSelector
                }
            };

            this._setWhiteList(rule, result);
            this._addThirdParty(result.trigger, rule);
            this._addMatchCase(result.trigger, rule);
            this._addDomainOptions(result.trigger, rule);

            return result;
        },

        convertScriptRule: function (rule) {
            // There is no way to convert these rules to safari format
            throw new Error("Script-injection rule " + rule.ruleText + " cannot be converted");
        },

        _checkWhiteListExceptions: function (rule, result) {
            function isDocumentRule(r) {
                return r.permittedContentType == (getClasses().UrlFilterRule.contentTypes.DOCUMENT | getClasses().UrlFilterRule.contentTypes.ALL);
            }

            function isUrlBlockRule(r) {
                return r.permittedContentType == (getClasses().UrlFilterRule.contentTypes.URLBLOCK | getClasses().UrlFilterRule.contentTypes.ALL);
            }

            if (rule.whiteListRule && rule.whiteListRule === true) {
                //Log.debug(rule);

                if (isDocumentRule(rule) || isUrlBlockRule(rule)) {
                    var parseDomainResult = this._parseRuleDomain(rule.urlRuleText);
                    //Log.debug(parseDomainResult);

                    if (isDocumentRule(rule)) {
                        //http://jira.performix.ru/browse/AG-8715
                        delete result.trigger["resource-type"];
                    }

                    if (parseDomainResult != null
                        && parseDomainResult.path != null
                        && parseDomainResult.path != "^"
                        && parseDomainResult.path != "/") {
                        //http://jira.performix.ru/browse/AG-8664
                        Log.debug('Whitelist special warning for rule: ' + rule.ruleText);

                        return;
                        //throw new Error("Whitelist special exception for $document rules");
                    }

                    if (parseDomainResult == null || parseDomainResult.domain == null) {
                        //throw new Error("Error parsing domain from rule");
                        Log.debug('Error parse domain from rule: ' + rule.ruleText);
                        return;
                    }

                    var domain = parseDomainResult.domain;

                    var included = [];
                    var excluded = [];

                    included.push(domain);
                    this._writeDomainOptions(included, excluded, result.trigger);

                    result.trigger["url-filter"] = URL_FILTER_ANY_URL;
                    delete result.trigger["resource-type"];

                } else if (rule.permittedContentType & getClasses().UrlFilterRule.contentTypes.ELEMHIDE) {
                    result.trigger["resource-type"] = ['document'];
                }
            }
        },

        convertUrlFilterRule: function (rule) {
            //Log.debug(rule);

            var urlFilter = this._createUrlFilterString(rule);
            //Log.debug(urlFilter);

            //For delimiter rules we just cut ending |$
            urlFilter = urlFilter.replace(/\|\$/g, "");

            //Safari doesn't support {digit} in regular expressions
            if (urlFilter.match(/\{\d*.\}/g)) {
                throw new Error("Safari doesn't support '{digit}' in regular expressions");
            }

            //Safari doesn't support | in regular expressions
            if (urlFilter.match(/[^\\]+\|+\S*/g)) {
                throw new Error("Safari doesn't support '|' in regular expressions");
            }

            var result = {
                trigger: {
                    "url-filter": urlFilter
                },
                action: {
                    type: "block"
                }
            };

            this._setWhiteList(rule, result);
            this._addResourceType(rule, result);
            this._addThirdParty(result.trigger, rule);
            this._addMatchCase(result.trigger, rule);
            this._addDomainOptions(result.trigger, rule);

            //Check whitelist exceptions
            this._checkWhiteListExceptions(rule, result);

            return result;
        }
    },

    /**
     * Add converter version message
     *
     * @private
     */
    _addVersionMessage: function () {
        Log.info('Safari Content Blocker Converter v' + CONVERTER_VERSION);
    },

    /**
     * Converts ruleText string to Safari format
     *
     * @param ruleText string
     * @param errors array
     * @returns {*}
     */
    convertLine: function (ruleText, errors) {
        try {
            if (ruleText == null || ruleText == ''
                || ruleText.indexOf('!') == 0 || ruleText.indexOf(' ') == 0
                || ruleText.indexOf(' - ') > 0) {
                return null;
            }

            var agRule = FilterRule.createRule(ruleText);
            if (agRule == null) {
                throw new Error('Cannot create rule from: ' + ruleText);
            }

            return this._convertAGRule(agRule);

        } catch (ex) {
            var message = 'Error converting rule from: ' + ruleText + ' cause:\n' + ex;
            message = ruleText + '\r\n' + message + '\r\n'
            Log.debug(message);

            if (errors) {
                errors.push(message);
            }

            return null;
        }
    },

    /**
     * Converts rule to Safari format
     *
     * @param rule AG rule object
     * @returns {*}
     */
    _convertAGRule: function (rule) {
        if (rule == null) {
            throw new Error('Invalid argument rule');
        }

        if (rule instanceof getClasses().CssFilterRule
            || rule instanceof CssFilterRule) {
            return this.AGRuleConverter.convertCssFilterRule(rule);
        }

        if (rule instanceof getClasses().ScriptFilterRule
            || rule instanceof ScriptFilterRule) {
            return this.AGRuleConverter.convertScriptRule(rule);
        }

        if (rule instanceof getClasses().UrlFilterRule
            || rule instanceof UrlFilterRule) {
            return this.AGRuleConverter.convertUrlFilterRule(rule);
        }

        throw new Error('Rule is not supported: ' + rule);
    },

    /**
     * Converts rule to Safari format
     *
     * @param rule AG rule object
     * @param errors array
     * @returns {*}
     */
    convertAGRule: function (rule, errors) {
        try {
            return this._convertAGRule(rule);
        } catch (ex) {
            var message = 'Error converting rule from: ' + rule + ' cause:\n' + ex;
            message = (rule.ruleText ? rule.ruleText : rule) + '\r\n' + message + '\r\n'
            Log.debug(message);

            if (errors) {
                errors.push(message);
            }

            return null;
        }
    },

    /**
     * Converts array to map object
     *
     * @param array
     * @param prop
     * @param prop2
     * @returns {null}
     * @private
     */
    _arrayToMap: function (array, prop, prop2) {
        var map = Object.create(null);
        for (var i = 0; i < array.length; i++) {
            var el = array[i];
            var property = el[prop][prop2];
            if (!(property in map)) {
                map[property] = [];
            }
            map[property].push(el);
        }
        return map;
    },

    /**
     * Updates if-domain and unless-domain fields.
     * Adds wildcard to every rule
     *
     * @private
     */
    _applyDomainWildcards: function (rules) {
        var addWildcard = function (array) {
            if (!array || !array.length) {
                return;
            }

            for (var i = 0; i < array.length; i++) {
                array[i] = "*" + array[i];
            }
        }

        rules.forEach(function (rule) {
            if (rule.trigger) {
                addWildcard(rule.trigger["if-domain"]);
                addWildcard(rule.trigger["unless-domain"]);
            }
        });
    },

    /**
     * Apply css exceptions
     * http://jira.performix.ru/browse/AG-8710
     *
     * @param cssBlocking
     * @param cssExceptions
     * @private
     */
    _applyCssExceptions: function (cssBlocking, cssExceptions) {
        Log.info('Applying ' + cssExceptions.length + ' css exceptions');

        /**
         * Adds exception domain to the specified rule.
         * First it checks if rule has if-domain restriction.
         * If so - it may be that domain is redundant.
         */
        var pushExceptionDomain = function (domain, rule) {
            var permittedDomains = rule.trigger["if-domain"];
            if (permittedDomains && permittedDomains.length) {

                // First check that domain is not redundant
                var applicable = permittedDomains.some(function (permitted) {
                    return domain.indexOf(permitted) >= 0;
                });

                if (!applicable) {
                    return;
                }
            }

            var ruleRestrictedDomains = rule.trigger["unless-domain"];
            if (!ruleRestrictedDomains) {
                ruleRestrictedDomains = [];
                rule.trigger["unless-domain"] = ruleRestrictedDomains;
            }

            ruleRestrictedDomains.push(domain);
        }

        var rulesMap = this._arrayToMap(cssBlocking, 'action', 'selector');
        var exceptionRulesMap = this._arrayToMap(cssExceptions, 'action', 'selector');

        var exceptionsAppliedCount = 0;
        var exceptionsErrorsCount = 0;

        for (var selector in exceptionRulesMap) {
            var selectorRules = rulesMap[selector];
            var selectorExceptions = exceptionRulesMap[selector];

            if (selectorRules && selectorExceptions) {

                selectorExceptions.forEach(function (exc) {

                    selectorRules.forEach(function (rule) {
                        var exceptionDomains = exc.trigger['if-domain'];
                        if (exceptionDomains && exceptionDomains.length > 0) {
                            exceptionDomains.forEach(function (domain) {
                                pushExceptionDomain(domain, rule);
                            });
                        }
                    });

                    exceptionsAppliedCount++;
                });
            }
        }

        var result = [];
        cssBlocking.forEach(function (r) {
            if (r.trigger["if-domain"] && (r.trigger["if-domain"].length > 0)
                && r.trigger["unless-domain"] && (r.trigger["unless-domain"].length > 0)) {
                Log.debug('Safari does not support permitted and restricted domains in one rule');
                Log.debug(JSON.stringify(r));
                exceptionsErrorsCount++;
            } else {
                result.push(r);
            }
        });

        Log.info('Css exceptions applied: ' + exceptionsAppliedCount);
        Log.info('Css exceptions errors: ' + exceptionsErrorsCount);
        return result;
    },

    /**
     * Compacts wide CSS rules
     * @param unsorted css elemhide rules
     * @return an object with two properties: cssBlockingWide and cssBlockingDomainSensitive
     */
    _compactCssRules: function(cssBlocking) {
        Log.info('Trying to compact ' + cssBlocking.length + ' elemhide rules');

        var cssBlockingWide = [];
        var cssBlockingDomainSensitive = [];

        var wideSelectors = [];
        var addWideRule = function() {
            if (!wideSelectors.length) {
                // Nothing to add
                return;
            }

            var rule = {
                trigger: {
                    "url-filter": URL_FILTER_ANY_URL
                },
                action: {
                    type: "css-display-none",
                    selector: wideSelectors.join(', ')
                }
            };
            cssBlockingWide.push(rule);
        };

        for (var i = 0; i < cssBlocking.length; i++) {

            var rule = cssBlocking[i];
            if (rule.trigger['if-domain'] || rule.trigger['unless-domain']) {
                cssBlockingDomainSensitive.push(rule);
            } else {
                wideSelectors.push(rule.action.selector);
                if (wideSelectors.length >= MAX_SELECTORS_PER_WIDE_RULE) {
                    addWideRule();
                    wideSelectors = [];
                }
            }
        }
        addWideRule();

        Log.info('Compacted result: wide=' + cssBlockingWide.length + ' domainSensitive=' + cssBlockingDomainSensitive.length);
        return {
            cssBlockingWide: cssBlockingWide,
            cssBlockingDomainSensitive: cssBlockingDomainSensitive
        };
    },

    /**
     * Converts array of rules to JSON
     *
     * @param rules array of strings or AG rules objects
     * @return content blocker object with converted rules grouped by type
     */
    _convertLines: function (rules) {
        Log.info('Converting ' + rules.length + ' rules');

        var contentBlocker = {
            // Elemhide rules (##)
            cssBlockingWide: [],
            // Elemhide rules (##) with domain restrictions
            cssBlockingDomainSensitive: [],
            // Elemhide exceptions ($elemhide)
            cssElemhide: [],
            // Url blocking rules
            urlBlocking: [],
            // Other exceptions
            other: [],
            // Errors
            errors: []
        };

        // Elemhide rules (##)
        var cssBlocking = [];

        // Elemhide exceptions (#@#)
        var cssExceptions = [];

        for (var i = 0, len = rules.length; i < len; i++) {
            var item;
            if (rules[i] != null && rules[i].ruleText) {
                item = this.convertAGRule(rules[i], contentBlocker.errors)
            } else {
                item = this.convertLine(rules[i], contentBlocker.errors);
            }

            if (item != null && item != '') {
                if (item.action == null || item.action == '') {
                    continue;
                }

                if (item.action.type == 'block') {
                    contentBlocker.urlBlocking.push(item);
                } else if (item.action.type == 'css-display-none') {
                    cssBlocking.push(item);
                } else if (item.action.type == 'ignore-previous-rules'
                    && (item.trigger["resource-type"] && item.trigger["resource-type"].length > 0
                    && item.trigger["resource-type"][0] == 'document')) {
                    //elemhide rules
                    contentBlocker.cssElemhide.push(item);
                } else if (item.action.type == 'ignore-previous-rules'
                    && (item.action.selector && item.action.selector != '')) {
                    // #@# rules
                    cssExceptions.push(item);
                } else {
                    contentBlocker.other.push(item);
                }
            }
        }

        // Applying CSS exceptions
        cssBlocking = this._applyCssExceptions(cssBlocking, cssExceptions);
        var cssCompact = this._compactCssRules(cssBlocking);
        contentBlocker.cssBlockingWide = cssCompact.cssBlockingWide;
        contentBlocker.cssBlockingDomainSensitive = cssCompact.cssBlockingDomainSensitive;

        var convertedCount = rules.length - contentBlocker.errors.length;
        var message = 'Rules converted: ' + convertedCount + ' (' + contentBlocker.errors.length + ' errors)';
        message += '\nBasic rules: ' + contentBlocker.urlBlocking.length;
        message += '\nElemhide rules (wide): ' + contentBlocker.cssBlockingWide.length;
        message += '\nElemhide rules (domain-sensitive): ' + contentBlocker.cssBlockingDomainSensitive.length;
        message += '\nExceptions (elemhide): ' + contentBlocker.cssElemhide.length;
        message += '\nExceptions (other): ' + contentBlocker.other.length;
        Log.info(message);

        return contentBlocker;
    },

    _createConvertationResult: function (contentBlocker, limit) {
        var overLimit = false;
        var converted = [];
        converted = converted.concat(contentBlocker.cssBlockingWide);
        converted = converted.concat(contentBlocker.cssBlockingDomainSensitive);
        converted = converted.concat(contentBlocker.cssElemhide);
        converted = converted.concat(contentBlocker.urlBlocking);
        converted = converted.concat(contentBlocker.other);

        if (limit && limit > 0 && converted.length > limit) {
            var message = '' + limit + ' limit is achieved. Next rules will be ignored.';
            contentBlocker.errors.push(message);
            Log.error(message);
            overLimit = true;
            converted = converted.slice(0, limit);
        }

        this._applyDomainWildcards(converted);
        Log.info('Content blocker length: ' + converted.length);

        var result = {
            convertedCount: converted.length,
            errorsCount: contentBlocker.errors.length,
            overLimit: overLimit,
            converted: JSON.stringify(converted, null, "\t")
        };

        return result;
    },

    /**
     * Converts array of rule texts or AG rules to JSON
     *
     * @param rules array of strings
     * @param limit over that limit rules will be ignored
     */
    convertArray: function (rules, limit) {
        this._addVersionMessage();

        if (rules == null || rules.length == 0) {
            Log.error('Invalid argument rules');
            return null;
        }

        var contentBlocker = this._convertLines(rules);

        return this._createConvertationResult(contentBlocker, limit);
    }
};
