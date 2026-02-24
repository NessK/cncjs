#!/usr/bin/env node

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const os = require("os");
const io = require("socket.io-client");
const { uIOhook, UiohookKey } = require("uiohook-napi");

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, "config.json");

const defaultConfig = {
    cncjs: {
        host: "127.0.0.1",
        port: 8000,
        protocol: "http",
        socketPath: "/socket.io",
        connectRetryMs: 5000,
        token: "",
        username: "",
        password: ""
    },
    machine: {
        port: "COM3",
        controllerType: "Grbl",
        baudrate: 115200,
        autoOpen: false
    },
    jogging: {
        singleStep: {
            small: 0.1,
            medium: 1,
            large: 10
        },
        smooth: {
            jogStep: 30,
            intervalMs: 200,
            speedHigh: 5000,
            speedMedium: 2000
        }
    },
    probe: {
        enabled: true,
        plateThickness: 25,
        probeDistance: 20,
        feedFast: 75,
        feedSlow: 45,
        retract1: 2,
        liftAfter: 3
    },
    logging: {
        verboseKeys: false
    }
};

const AXES = {
    X: "X",
    Y: "Y",
    Z: "Z"
};

const DIRECTION = {
    positive: "",
    negative: "-"
};

const KEY_CODES = {
    xNeg: UiohookKey.Semicolon,
    xNegAlt: UiohookKey.Backquote,
    xPos: UiohookKey.Quote,
    yPos: UiohookKey.Comma,
    yNeg: UiohookKey.Period,
    zPos: UiohookKey.Minus,
    zNeg: UiohookKey.Slash,
    zNegAlt: UiohookKey.Backslash,
    p: UiohookKey.P
};

let socket = null;
let smoothJogging = false;
let smoothJoggingTimer = null;
const keyIsDown = new Set();

const deepMerge = (base, override) => {
    if (Array.isArray(base) || Array.isArray(override)) {
        return override;
    }
    if (typeof base !== "object" || base === null) {
        return override;
    }
    const out = { ...base };
    for (const [key, value] of Object.entries(override || {})) {
        if (value && typeof value === "object" && !Array.isArray(value) && typeof base[key] === "object") {
            out[key] = deepMerge(base[key], value);
        } else {
            out[key] = value;
        }
    }
    return out;
};

const expandUserPath = (filePath) => {
    if (!filePath) {
        return filePath;
    }
    if (filePath.startsWith("~/")) {
        return path.join(os.homedir(), filePath.substring(2));
    }
    return filePath;
};

const loadConfig = (configPath) => {
    const resolvedPath = path.resolve(expandUserPath(configPath || DEFAULT_CONFIG_PATH));
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Missing config file: ${resolvedPath}`);
    }
    const raw = fs.readFileSync(resolvedPath, "utf8");
    const userConfig = JSON.parse(raw);
    return deepMerge(defaultConfig, userConfig);
};

const parseArgs = () => {
    const args = process.argv.slice(2);
    let configPath = DEFAULT_CONFIG_PATH;
    for (let i = 0; i < args.length; i++) {
        const value = args[i];
        if ((value === "--config" || value === "-c") && args[i + 1]) {
            configPath = args[i + 1];
            i++;
        }
    }
    return { configPath };
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildBaseUrl = (config) => {
    return `${config.cncjs.protocol}://${config.cncjs.host}:${config.cncjs.port}`;
};

const signinAndGetToken = async (config) => {
    if (config.cncjs.token) {
        return config.cncjs.token;
    }

    const payload = {};
    if (config.cncjs.username || config.cncjs.password) {
        payload.name = config.cncjs.username || "";
        payload.password = config.cncjs.password || "";
    }

    const response = await fetch(`${buildBaseUrl(config)}/api/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Failed /api/signin (${response.status}): ${body}`);
    }

    const body = await response.json();
    if (!body.token) {
        throw new Error("Missing JWT token in /api/signin response");
    }

    return body.token;
};

const write = (config, data) => {
    if (!socket || !socket.connected) {
        return;
    }
    socket.emit("write", config.machine.port, data);
};

const jogStop = (config) => {
    if (!socket || !socket.connected) {
        return;
    }
    // Use CNCjs controller command to avoid sending raw realtime bytes as UTF-8 text.
    socket.emit("command", config.machine.port, "jog:stop");
};

const jogSingleStep = (config, axis, dir, jogDistance) => {
    console.log(`JOG STEP ${axis}${dir}${jogDistance}`);
    write(config, "G91\n");
    write(config, `G0 ${axis}${dir}${jogDistance}\n`);
    write(config, "G90\n");
};

const smoothJog = (config, axis, dir, jogDistance, jogSpeed) => {
    write(config, `$J=G91 G21 ${axis}${dir}${jogDistance} F${jogSpeed}\n`);
    if (smoothJogging) {
        smoothJoggingTimer = setTimeout(
            smoothJog,
            config.jogging.smooth.intervalMs,
            config,
            axis,
            dir,
            jogDistance,
            jogSpeed
        );
    }
};

const startStopSmoothJog = (config, axis, dir, jogStep, jogSpeed) => {
    if (!smoothJogging) {
        smoothJogging = true;
        smoothJog(config, axis, dir, jogStep, jogSpeed);
        console.log(`SMOOTH JOG ${axis}${dir}${jogStep} F${jogSpeed}`);
    } else {
        smoothJogging = false;
        if (smoothJoggingTimer) {
            clearTimeout(smoothJoggingTimer);
            smoothJoggingTimer = null;
        }
        jogStop(config);
        console.log("STOP JOG");
    }
};

const stopSmoothJogIfActive = (config, reason) => {
    if (!smoothJogging) {
        return;
    }
    smoothJogging = false;
    if (smoothJoggingTimer) {
        clearTimeout(smoothJoggingTimer);
        smoothJoggingTimer = null;
    }
    jogStop(config);
    console.log(`STOP JOG (${reason})`);
};

const runProbe = (config) => {
    if (!config.probe.enabled) {
        return;
    }
    console.log("PROBE TRIGGER (Alt+P) -> Z-only probe");
    const p = config.probe;
    write(config, "G21\n");
    write(config, "G91\n");
    write(config, `G38.2 Z-${p.probeDistance} F${p.feedFast}\n`);
    write(config, `G0 Z${p.retract1}\n`);
    write(config, `G38.2 Z-${p.probeDistance} F${p.feedSlow}\n`);
    write(config, "G4 P0.1\n");
    write(config, `G10 L20 P1 Z${p.plateThickness}\n`);
    write(config, "G4 P0.1\n");
    write(config, `G0 Z${p.liftAfter}\n`);
    write(config, "G90\n");
};

const getAxisDirectionForKey = (keycode) => {
    switch (keycode) {
    case KEY_CODES.xNeg:
    case KEY_CODES.xNegAlt:
        return { axis: AXES.X, dir: DIRECTION.negative };
    case KEY_CODES.xPos:
        return { axis: AXES.X, dir: DIRECTION.positive };
    case KEY_CODES.yPos:
        return { axis: AXES.Y, dir: DIRECTION.positive };
    case KEY_CODES.yNeg:
        return { axis: AXES.Y, dir: DIRECTION.negative };
    case KEY_CODES.zPos:
        return { axis: AXES.Z, dir: DIRECTION.positive };
    case KEY_CODES.zNeg:
    case KEY_CODES.zNegAlt:
        return { axis: AXES.Z, dir: DIRECTION.negative };
    default:
        return null;
    }
};

const handleKeyDown = (config, keycode, event) => {
    const isShift = !!event.shiftKey;
    const isAlt = !!event.altKey;
    const isCtrl = !!event.ctrlKey;

    if (keycode === KEY_CODES.p && isAlt && !isCtrl) {
        runProbe(config);
        return;
    }

    const axisDirection = getAxisDirectionForKey(keycode);
    if (!axisDirection) {
        return;
    }

    if (isShift && isAlt && !isCtrl) {
        startStopSmoothJog(
            config,
            axisDirection.axis,
            axisDirection.dir,
            config.jogging.smooth.jogStep,
            config.jogging.smooth.speedMedium
        );
        return;
    }

    if (isShift && !isAlt && !isCtrl) {
        startStopSmoothJog(
            config,
            axisDirection.axis,
            axisDirection.dir,
            config.jogging.smooth.jogStep,
            config.jogging.smooth.speedHigh
        );
        return;
    }

    if (isCtrl && !isAlt && !isShift) {
        jogSingleStep(config, axisDirection.axis, axisDirection.dir, config.jogging.singleStep.large);
        return;
    }

    if (isAlt && !isCtrl && !isShift) {
        jogSingleStep(config, axisDirection.axis, axisDirection.dir, config.jogging.singleStep.medium);
        return;
    }

    if (!isAlt && !isCtrl && !isShift) {
        jogSingleStep(config, axisDirection.axis, axisDirection.dir, config.jogging.singleStep.small);
    }
};

const setupKeyboardListener = (config) => {
    uIOhook.on("keydown", (event) => {
        const keycode = event && typeof event.keycode === "number" ? event.keycode : 0;
        if (!keycode) {
            return;
        }
        if (config.logging.verboseKeys) {
            console.log(`KEYDOWN code=${keycode} ctrl=${event.ctrlKey} alt=${event.altKey} shift=${event.shiftKey}`);
        }
        if (keyIsDown.has(keycode)) {
            return;
        }
        keyIsDown.add(keycode);
        handleKeyDown(config, keycode, event);
    });

    uIOhook.on("keyup", (event) => {
        const keycode = event && typeof event.keycode === "number" ? event.keycode : 0;
        if (!keycode) {
            return;
        }
        if (config.logging.verboseKeys) {
            console.log(`KEYUP code=${keycode}`);
        }
        keyIsDown.delete(keycode);
    });

    uIOhook.start();
};

const tryAutoOpenPort = (config) => {
    if (!config.machine.autoOpen) {
        return;
    }

    socket.emit(
        "open",
        config.machine.port,
        {
            controllerType: config.machine.controllerType,
            baudrate: config.machine.baudrate
        },
        (err) => {
            if (err) {
                console.error(`Auto-open failed on ${config.machine.port}: ${err.message || err}`);
                return;
            }
            console.log(`Port opened: ${config.machine.port}`);
        }
    );
};

const connectSocket = async (config) => {
    const token = await signinAndGetToken(config);
    const baseUrl = buildBaseUrl(config);
    socket = io(baseUrl, {
        path: config.cncjs.socketPath,
        transports: ["websocket"],
        query: `token=${token}`
    });

    socket.on("connect", () => {
        console.log(`Connected to CNCjs: ${baseUrl}`);
        tryAutoOpenPort(config);
    });

    socket.on("connect_error", (err) => {
        console.error(`Socket connect error: ${err.message || err}`);
    });

    socket.on("disconnect", (reason) => {
        console.error(`Socket disconnected: ${reason}`);
        stopSmoothJogIfActive(config, "socket disconnect");
    });
};

const connectSocketWithRetry = async (config) => {
    while (true) {
        try {
            await connectSocket(config);
            return;
        } catch (err) {
            console.error(`Unable to connect to CNCjs. Retrying in ${config.cncjs.connectRetryMs}ms`);
            console.error(err && err.message ? err.message : err);
            await delay(config.cncjs.connectRetryMs);
        }
    }
};

const shutdown = async () => {
    if (smoothJoggingTimer) {
        clearTimeout(smoothJoggingTimer);
        smoothJoggingTimer = null;
    }
    smoothJogging = false;
    keyIsDown.clear();
    try {
        uIOhook.stop();
    } catch (err) {
        // Ignore key hook stop errors during process shutdown.
    }
    if (socket) {
        socket.close();
        socket = null;
    }
    await delay(50);
    process.exit(0);
};

const main = async () => {
    const { configPath } = parseArgs();
    const config = loadConfig(configPath);

    console.log(`Pendant bridge config: ${path.resolve(configPath)}`);
    setupKeyboardListener(config);
    await connectSocketWithRetry(config);

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
};

main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
