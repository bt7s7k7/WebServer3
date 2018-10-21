var B = require("bUtils")
var fs = require("fs")
var path = require("path")
var https = require("https")
var mime = require("mimer")
var config;
var server
var httpsKey, httpsCert
var usedBackup = false
var serverDir;
var codes = {
	404: { name: "Not Found", error: true },
	200: { name: "Success", error: false },
	500: { name: "Internal Server Error", error: true },
	203: { name: "Handled by plugin", error: false }
}
var pluginEmitter = {
	_listeners: {},
	listeners(name) {
		if (name in this._listeners) {
			return this._listeners[name]
		} else return []
	},
	on(name, callback) {
		if (!(name in this._listeners)) {
			this._listeners[name] = []
		}
		this._listeners[name].push(callback)
	}
}

B.log("Starting initialization...")

global.run = () => {
	setup().then(() => { }, (err) => { console.error(err.stack) }).catch((err) => { console.error(err.stack) })
}

run()


global.debug = () => { debugger }

//setTimeout(() => { },100000)

async function setup() {
	B.log("Loading config...")
	var [err, sconfig] = await B.loadCfgFile.promise(path.join(__dirname, "config.ini"), {
		default_port: "number",
		backup_port: "number",
		http_server_port: "number",
		default_dir: "string",
		SSL: {
			key_file: "string",
			cert_file: "string"
		}
	})
	if (err) throw err
	B.write(sconfig)
	B.log(" '" + __dirname + "'")
	config = sconfig

	var keyDir = path.resolve(__dirname, config.SSL.key_file)
	var certDir = path.resolve(__dirname, config.SSL.cert_file)

	if (B.args.get[0]) {
		serverDir = (path.resolve(__dirname, B.args.get[0]))
		B.log("Server directory overriden to '" + serverDir + "' from '" + B.args.get[0] + "'")
	} else {
		serverDir = path.resolve(__dirname, config.default_dir)
		B.log("Server directory set to '" + serverDir + "' from '" + config.default_dir + "'")
	}

	serverDir = path.resolve(__dirname, serverDir)

	B.log("Loding HTTPS certificates...")
	await new Promise((resolve, reject) => {
		var read = 0

		fs.readFile(keyDir, (err, data) => {
			if (err) {
				B.log("Tryied to read '" + config.SSL.key_file + "'")
				return reject(err)
			}

			httpsKey = data
			B.log("  Key loaded")
			read++;
			if (read >= 2) resolve()
		})
		fs.readFile(certDir, (err, data) => {
			if (err) {
				B.log("Tryied to read '" + config.SSL.cert_file + "'")
				return reject(err)
			}

			httpsCert = data
			B.log("  Certificate loaded")
			read++;
			if (read >= 2) resolve()
		})
	})

	B.log("Loading plugins")
	try {
		var plugins = await fs.readdir.promiseNCS(path.join(__dirname, "plugins"))
	} catch (err) {
		var plugins = []
		B.log(err)
	}

	for (let pPath of plugins[0]) {
		if (path.extname(pPath) != ".js") continue
		let content
		B.log("Loading plugin '" + pPath + "'")
		try {
			content = await fs.readFile.promiseNCS(path.join(__dirname, "plugins", pPath))
		} catch (err) {
			B.log(err)
			continue
		}

		content = content.toString()
		eval("()=>{\n" + content + "\n}")()
	}


	B.log("Initializing server...")


	server = https.createServer({
		key: httpsKey,
		cert: httpsCert
	}, handleConnection)

	server.maxConnections = Infinity

	server.on("error", (err) => {
		if (!usedBackup) {
			B.log("Failed to listen on default port " + config.default_port + ", trying to listen on backup port " + config.backup_port + "...")
			server.listen(config.backup_port)
			usedBackup = true
		} else {
			B.log("Failed to listen on backup port " + config.backup_port + ", requesting a unused port from the os...")
			server.listen()
		}
	})


	server.on("listening", () => {
		B.log("Server listening on port " + server.address().port)
	})


	B.log("Trying to listen on default port " + config.default_port + "...")
	server.listen(config.default_port)

	var redirectServer = require("http").createServer((req, res) => {
		B.log(B.chalk.cyan("Redirecting to HTTPS"))
		writeRedirect(res, "https://" + req.headers['host'] + req.url)
	})

	redirectServer.on("error", (err) => {
		B.log("Redirect server port used, requesting a unused port from the os...")
		redirectServer.listen()
	})

	redirectServer.on("listening", () => {
		B.log("Redirect server running on port " + redirectServer.address().port)
	})

	B.log("Starting redirect server on port " + config.http_server_port)
	redirectServer.listen(config.http_server_port)
}

function writeRedirect(res, path) {
	res.writeHead(301, { "Location": path });
	res.end();
}

function writeIndex(request, response, address, url, filepath, files, callback = (response) => { }, header = "Directory Listing", fileCallback = (href, stat, v) => {
	if (stat && stat.isDirectory()) {
		return ("<a href=\"" + href + "\" style=\"color:blue\">" + B.escapeHTML(v) + "</a><br />")
	} else {
		if ([".html", ".txt"].indexOf(path.extname(v)) != -1) {
			return ("<a href=\"" + href + "\" style=\"color:black\">" + B.escapeHTML(v) + "</a><br />")
		} else {
			return ("<a href=\"" + href + "\" style=\"color:red\">" + B.escapeHTML(v) + "</a><br />")
		}
	}
}) {
	files.sort()
	var finish = () => {
		var filesSorted = Object.keys(fileTags).sort()
		filesSorted.forEach((v) => {
			if (lastLetter != v[0].toUpperCase()) {
				lastLetter = v[0].toUpperCase()
				response.write("<b>" + lastLetter + ":</b><br />")
			}
			response.write(fileTags[v], "utf8")
		})
		callback(response)
		response.end("</body>\n</html>")
	}
	var done = 0
	var lastLetter = ""
	var fileTags = {}

	response.write(`<html>\n<head>\n<title>${header}</title>\n</head><body>\n<h1>${header}</h1><br />\n`)
	if (files.length == 0) {
		finish()
	}
	files.forEach(v => {
		var fullPath = path.join(filepath, v)
		fs.stat(fullPath, (err, stat) => {
				var href = (url.pathname.length > 1) ? url.pathname + "/" + v : v;
			if (err) {
				fileTags[v] = fileCallback(href, null, v)
			} else {
				fileTags[v] = fileCallback(href, stat, v)
			}
			done++
			if (done >= files.length) {
				finish()
			}
		})
	})
}

function handleConnection(request, response) {
	var address = request.socket.address()
	var url = require("url").parse(request.url)
	var filepath = path.join(serverDir, decodeURIComponent(url.pathname))
	var plugin = (eventName, args) => {
		var handled = false
		for (let callback of pluginEmitter.listeners(eventName)) {
			try {
				callback(...args, () => { handled = true })
			} catch (err) {
				errorResponse(address, filepath, response, err)
				logConnetion(address, url.pathname, 500)
				B.log(err.stack)
			}
			if (handled) {
				logConnetion(address, url.pathname, 203)
				break
			}
		}
		return handled
	}
	if (plugin("connection", [request, response, address, url, filepath])) return

	fs.stat(filepath, (err, stats) => {
		if (err) {
			logConnetion(address, url.pathname, 404)
			response.writeHead(404, codes[404].name, { "Content-Type": mime(".html") })
			response.end("<html><meta charset=\"utf- 8\"><head><title>404 - Not found</title></head><body><h1>404 - Not found</h1><br />The file '" + B.escapeHTML(filepath) + "' you requested is not avalible on the server<br /><b><a href=\"/\">GOTO INDEX</a></b></body></html>");
		} else {
			//response.writeHead(200, "Success", { "Content-Type": mime(".html") })
			if (stats.isDirectory()) {
				fs.readdir(filepath, (err, files) => {
					if (err) {
						errorResponse(address, url.pathname, response, err)
					} else {
						if (plugin("index", [request, response, address, url, filepath, files])) return
						logConnetion(address, url.pathname, 200)
						response.writeHead(200, codes[200].name, { "Content-Type": mime(".html") })
						writeIndex(request, response, address, url, filepath, files)
					}
				})
			} else {
				fs.readFile(filepath, (err, data) => {
					if (err) {
						errorResponse(address, url.pathname, response, err)
					} else {
						if (plugin("file", [request, response, address, url, filepath, data])) return
						logConnetion(address, url.pathname, 200)
						response.writeHead(200, codes[200].name, { "Content-Type": mime(path.extname(filepath)) })
						response.end(data)
					}
				})
			}
		}
	})
}

var postInitNewline = false
function logConnetion({ address, port }, filepath, code) {
	if (!postInitNewline) {
		B.log()
		postInitNewline = true;
	}
	var msg = "<" + address + ":" + port + "> [" + filepath + "] " + ((code in codes) ? codes[code].name : "") + " " + code
	if ((code in codes) && codes[code.error]) {
		B.log(B.chalk.redBright(msg))
	} else {
		B.log(B.chalk.greenBright(msg))
	}
}

function errorResponse(address, filepath, response, err) {
	logConnetion(address, filepath, 500)
	response.writeHead(500, codes[500].name, { "Content-Type": mime(".html") })
	response.end("<html><head><title>500 - Internal Server Error</title></head><body><h1>500 - Internal Server Error</h1><br />" + B.escapeHTML(err.stack) + "<br /><b><a href=\"/\">GOTO INDEX</a></b></body></html>")
	B.log(B.chalk.redBright(err.stack))
}
