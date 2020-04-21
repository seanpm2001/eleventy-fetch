const fs = require("fs");
const fsp = fs.promises; // Node 10+
const path = require("path");
const fetch = require("node-fetch");
const shorthash = require("short-hash");
const flatCache = require("flat-cache");
const debug = require("debug")("EleventyCacheAssets");

class AssetCache {
	constructor(url, cacheDirectory) {
		this.url = url;
		this.cacheDirectory = cacheDirectory || ".cache";
		this.defaultDuration = "1d";
	}

	get url() {
		return this._url;
	}

	set url(url) {
		let urlHash = shorthash(url);
		if(urlHash !== this.urlHash) {
			this._cacheLocationDirty = true;
		}

		this.urlHash = urlHash;
		this._url = url;
	}

	get cacheDirectory() {
		return this._cacheDirectory;
	}

	set cacheDirectory(dir) {
		if(dir !== this._cacheDirectory) {
			this._cacheLocationDirty = true;
		}

		this._cacheDirectory = dir;
	}

	get cacheFilename() {
		return `eleventy-cache-assets-${this.urlHash}`;
	}

	get cachePath() {
		return path.join(this.cacheDirectory, this.cacheFilename);
	}

	get cache() {
		if(!this._cache || this._cacheLocationDirty) {
			this._cache = flatCache.load(this.cacheFilename, path.resolve(this.cacheDirectory));
		}
		return this._cache;
	}

	getDurationMs(duration = "0s") {
		let durationUnits = duration.substr(-1);
		let durationMultiplier;
		if(durationUnits === "s") {
			durationMultiplier = 1;
		} else if(durationUnits === "m") {
			durationMultiplier = 60;
		} else if(durationUnits === "h") {
			durationMultiplier = 60 * 60;
		} else if(durationUnits === "d") {
			durationMultiplier = 60 * 60 * 24;
		} else if(durationUnits === "w") {
			durationMultiplier = 60 * 60 * 24 * 7;
		} else if(durationUnits === "y") {
			durationMultiplier = 60 * 60 * 24 * 365;
		}

		let durationValue = parseInt(duration.substr(0, duration.length - 1), 10);
		return durationValue * durationMultiplier * 1000;
	}

	save(buffer) {
		let cache = this.cache;
		cache.setKey(this.url, {
			cachedAt: Date.now(),
			buffer: buffer.toJSON()
		});
		cache.save();
	}

	get cachedObject() {
		return this.cache.getKey(this.url);
	}

	needsToFetch(duration) {
		if(!this.cachedObject) { // not cached
			return true;
		} else if(!duration || duration === "*") {
			// no duration specified (plugin default is 1d, but if this is falsy assume infinite)
			// "*" is infinite duration
			return false;
		}

		debug("Cache check for: %o (duration: %o)", this.url, duration);

		let compareDuration = this.getDurationMs(duration);
		let expiration = this.cachedObject.cachedAt + compareDuration;
		let expirationRelative = Math.abs(Date.now() - expiration);

		if(expiration > Date.now()) {
			debug("Cache okay, expires in %o s (%o)", expirationRelative/1000, new Date(expiration));
			return false;
		}

		debug("Cache expired %o s ago (%o)", expirationRelative/1000, new Date(expiration));
		return true;
	}

	convertTo(buffer, type) {
		if(type === "json") {
			return JSON.parse(buffer.toString());
		}
		if(type === "text") {
			return buffer.toString();
		}
		// default is type "buffer"
		return buffer;
	}

	async fetch(options = {}) {
		let needsToFetch = this.needsToFetch(options && options.duration || this.defaultDuration);

		if( needsToFetch === false ) {
			return this.convertTo(Buffer.from(this.cachedObject.buffer), options.type);
		} else {
			// make cacheDirectory if it does not exist.
			await fsp.mkdir(this.cacheDirectory, {
				recursive: true
			});

			console.log( `Caching: ${this.url}` ); // @11ty/eleventy-cache-assets
			let response = await fetch(this.url);
			if(!response.ok) {
				throw new Error(`Bad response for ${this.url} (${res.status}): ${res.statusText}`)
			}

			let body = await response.buffer();
			this.save(body);
			return this.convertTo(body, options.type);
		}
	}
}
module.exports = AssetCache;