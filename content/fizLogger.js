/*
The MIT License

Copyright (c) 2009, Stanford University

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
*/


var fizLogger = (function() {
    window.addEventListener("load", windowLoadEvent, false);
    window.addEventListener("unload", windowUnloadEvent, false);

    // We need to keep a reference to all listeners so that they're not
    // garbage collected
    var listeners = [];
    // All log data that has not been sent to the server
    var log = "";
    // Uniquely identifies a user for a particular session
    var userId;
    // Used to salt hashes. Never transmitted to the server
    var salt;
    // Transmit every 5 minutes
    var timeToWait = 1000 * 60 * 3;
    // Current version. This should be updated if the protocol/behavior changes
    var version = 3;
    // Number of transmisions sent
    var count = 0;
    // URL for collecting logs at server
    var url = "http://fiz.stanford.edu:8000/log/post";

    /**
     * Called every time a new window is created
     */
    function windowLoadEvent() {
        initHashes();

        addListenersForTab(gBrowser.selectedTab);

        var container = gBrowser.tabContainer;
        if (container) {
            container.addEventListener("TabOpen", tabOpenEvent, false);
            container.addEventListener("TabClose", tabCloseEvent, false);
            container.addEventListener("TabSelect", tabSelectEvent, false);
        }

        logObject({type: "new window"});

        window.setInterval(transmit, timeToWait);
    }

    /**
     * Called every time a window is closed
     */
    function windowUnloadEvent() {
        logObject({type: "close window"});
        transmit();
    }

    /**
     * If the userId and salt have not yet been created, create them.
     */
    function initHashes() {
        var prefs = Components.classes["@mozilla.org/preferences-service;1"]
            .getService(Components.interfaces.nsIPrefBranch);
        prefs = prefs.getBranch("extensions.fizLogger.");
        try {
            userId = prefs.getCharPref("FizUserId");
        } catch (e) {
            userId = randomHash();
            prefs.setCharPref("FizUserId", userId);
            var prefService = Components.classes["@mozilla.org/preferences-service;1"]
                .getService(Components.interfaces.nsIPrefService);
            prefService.savePrefFile(null);
        }

        salt = Application.storage.get("FizSalt", null);
        if (salt == null) {
            salt = randomHash();
            Application.storage.set("FizSalt", salt);
        }
    }

    /**
     * Returns a random string of alphanumeric characters of length 16
     */
    function randomHash() {
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz0123456789";
        var str = "";
        for (var i = 0; i < 16; i++) {
            var num = Math.floor(Math.random() * chars.length);
            str += chars.substring(num, num+1);
        }
        return str;
    }

    /**
     * For every tab, we want to know when there is a history event or when a new
     * page is loaded. This function adds the appropriate listeners
     */
    function addListenersForTab(tab) {
        var session = tab.linkedBrowser.sessionHistory;
        var listener = getHistoryListener(tab);
        listeners.push(listener);
        session.addSHistoryListener(listener);

        listener = getProgressListener(tab);
        listeners.push(listener);
        gBrowser.getBrowserForTab(tab).addProgressListener(listener,
                    Components.interfaces.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
    }

    /**
     * Returns a history listener for the given session
     */
    function getHistoryListener(tab) {
        var tabId = tab === null ? "none?" : tab.linkedPanel;

        return {
            OnHistoryNewEntry: function(uri, a) {
                logUri({type: "new history entry", tabId: tabId}, uri);
                return true;
            },
            OnHistoryGoBack: function(uri) {
                logUri({type: "history go back", tabId: tabId}, uri);
                return true;
            },
            OnHistoryGoForward: function(uri) {
                logUri({type: "history go forward", tabId: tabId}, uri);
                return true;
            },
            OnHistoryReload: function(uri, flags) {
                logUri({type: "history reload", tabId: tabId}, uri);
                return true;
            },
            OnHistoryGotoIndex: function(index, uri) {
                logObject({type: "history goto index", tabId: id, index: index}, uri);
                return true;
            },
            OnHistoryPurge: function(numEntries) {
                logObject({type: "history purge", numEntries: numEntries});
                return true;
            },
            QueryInterface: function(aIID) {
                if (aIID.equals(Components.interfaces.nsISHistoryListener) ||
                    aIID.equals(Components.interfaces.nsISupportsWeakReference) ||
                    aIID.equals(Components.interfaces.nsISupports)) {
                    return this;
                }
                throw Components.Exception(Components.results.NS_ERROR_NO_INTERFACE);
            }
        }
    }

    /**
     * Called whenever a new tab is opened
     */
    function tabOpenEvent(e) {
        addListenersForTab(e.target);
        logObject({type: "open tab", tabId: e.target.linkedPanel});
    }

    /**
     * Called whenever a tab is closed
     */
    function tabCloseEvent(e) {
        logObject({type: "close tab", tabId: e.target.linkedPanel});
    }

    /**
     * Called when a tab is selected
     */
    function tabSelectEvent(e) {
        logObject({type: "select tab", tabId: e.target.linkedPanel});
    }

    /**
     * Returns a new progress listener to use for the given tab
     */
    function getProgressListener(tab) {
        var tabId = tab == null ? "none?" : tab.linkedPanel;
        return {
            onLocationChange: function(progress, request, uri) {
                logUri({type: "location change", tabId: tabId}, uri);
            },

            onStateChange: function() {},
            onProgressChange: function() {},
            onStatusChange: function() {},
            onSecurityChange: function() {},
            onLinkIconAvailable: function() {},
            QueryInterface: function(aIID) {
                return this;
                if (aIID.equals(Components.interfaces.nsIWebProgressListener) ||
                    aIID.equals(Components.interfaces.nsISupportsWeakReference) ||
                    aIID.equals(Components.interfaces.nsISupports)) {
                    return this;
                }
                throw Components.results.NS_NOINTERFACE;
            }
        }
    }

    /**
     * Adds the current object and its properties to the log that will be
     * transmitted to the server
     */
    function logObject(o) {
        var s = "";
        for (i in o) {
            try {
                s += i + ": " + o[i] + "\n";
            } catch (e) {} // some nsIS objects don't like the above line
        }

        s += "time: " + getTime() + "\n";
        s += "selectedTabId: " + gBrowser.selectedTab.linkedPanel + "\n";
        s += "---\n";
        log += s;
    }

    /**
     * Transmits the log to the sever, and sets a timeout to do it again
     */
    function transmit() {
        if (log == "") {
            return;
        }
        count++;

        var h = new XMLHttpRequest();

        h.open("POST", url, true);
        h.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        var logCache = log;
        log = "";
        h.addEventListener("error", function(e) {
            log += logCache;
        }, false);
        h.send("id=" + userId + "&data=" +
               "begin transmit version " + version + "; #" + count + "\n" + logCache + "end transmit\n"
              );
    }

    /**
     * Adds uri info to the object and then logs it
     */
    function logUri(o, uri) {
        if (uri == null || uri == undefined) {
            o.host = "none";
            o.path = "none";
        } else {
            try {
                o.host = getHash(uri.hostPort);
                o.path = getHash(uri.path);
            } catch (e) {
                o.host = "none";
                o.path = "none";
            }
        }

        logObject(o);
    }

    /**
     * Returns the current time in milliseconds
     */
    function getTime() {
        var date = new Date();
        return date.getTime();
    }

    /**
     * Hashes the given value
     */
    function getHash(str) {
        //return str; // uncomment to see plaintext values

        // Taken from https://developer.mozilla.org/en/nsICryptoHash#Example_Code
        // Code samples are available under the MIT license
        var converter =
            Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].
            createInstance(Components.interfaces.nsIScriptableUnicodeConverter);

        // we use UTF-8 here, you can choose other encodings.
        converter.charset = "UTF-8";
        // result is an out parameter,
        // result.value will contain the array length
        var result = {};
        // data is an array of bytes
        var data = converter.convertToByteArray(str + salt, result);
        var ch = Components.classes["@mozilla.org/security/hash;1"]
            .createInstance(Components.interfaces.nsICryptoHash);
        ch.init(ch.MD5);
        ch.update(data, data.length);
        var hash = ch.finish(false);

        // return the two-digit hexadecimal code for a byte
        function toHexString(charCode)
        {
            return ("0" + charCode.toString(16)).slice(-2);
        }

        // convert the binary hash data to a hex string.
        var s = [toHexString(hash.charCodeAt(i)) for (i in hash)].join("");
        // s now contains your hash in hex: should be
        // 5eb63bbbe01eeed093cb22bb8f5acdc3
        return s;
    }
})();

