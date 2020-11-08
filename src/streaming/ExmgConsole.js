function getConsoleFunc(enable = true, prefix = '', type = 'log') {
    return enable ?
        console[type].bind(console, prefix ? `${prefix} |` : '') : (() => undefined);
}

export {getConsoleFunc};
