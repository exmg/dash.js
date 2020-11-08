function getLogFunc(enable = true, prefix = "") {
    return enable
        ? console.log.bind(console, prefix ? `${prefix} |` : "")
        : (() => undefined);
}

export {getLogFunc}
