export class ExmgRequestCache {
    constructor() {
        this.map = {};
    }

    put(url, data) {
        this.map[url] = data;
    }

    get(url) {
        return this.map[url] || null;
    }
}
