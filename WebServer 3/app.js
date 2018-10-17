'use strict';
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
	500: { name: "Internal Server Error", error: true }
}

B.log("Starting initialization...")

global.run = () => {
	debugger
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
		serverDir = (path.resolve(__dirname,B.args.get[0]))
		B.log("Server directory overriden to '" + serverDir + "' from '" + B.args.get[0] + "'")
	} else {
		serverDir = path.resolve(__dirname,config.default_dir)
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

	B.log("Initializing server...")

	server = https.createServer({
		key: httpsKey,
		cert: httpsCert
	}, handleConnection) //TODO: Figure out why are there is no data

	server.maxConnections = Infinity

	server.on("error", (err) => {
		if (!choice(err.code,
			"EADDRINUSE", () => {
				if (!usedBackup) {
					B.log("Failed to listen on default port " + config.default_port + ", trying to listen on backup port " + config.backup_port + "...")
					server.listen(config.backup_port)
					usedBackup = true
				} else {
					B.log("Failed to listen on backup port " + config.backup_port + ", requesting a unused port from the os...")
					server.listen()
				}
			}
		)) {
			throw err
		}
	})


	server.on("listening", () => {
		B.log("Server listening on port " + server.address().port)
	})


	B.log("Trying to listen on default port " + config.default_port + "...")
	server.listen(config.default_port)

	var redirectServer = require("http").createServer((req, res) => {
		B.log(B.chalk.cyan("Redirecting to HTTPS"))
		res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
		res.end();
	})

	redirectServer.on("error", (err) => {
		if (!choice(err.code,
			"EADDRINUSE", () => {
				B.log("Redirect server port used")
			}
		)) {
			throw err
		}
	})

	redirectServer.on("listening", () => {
		B.log("Redirect Server Running")
	})

	B.log("Starting redirect server on port 80")
	redirectServer.listen(80)
}

function handleConnection(request, response) {
	var address = request.socket.address()
	var url = require("url").parse(request.url)
	var filepath = path.join(serverDir, decodeURIComponent(url.pathname))

	fs.stat(filepath, (err, stats) => {
		if (err) {
			logConnetion(address, url.pathname, 404)
			response.writeHead(404, codes[404].name, { "Content-Type": mime(".html") })
			response.end("<html><head><title>404 - Not found</title></head><body><h1>404 - Not found</h1><br />The file '" + B.escapeHTML(url.pathname) + "' you requested is not avalible on the server<br /><b><a href=\"/\">GOTO INDEX</a></b></body></html>");
		} else {
			//response.writeHead(200, "Success", { "Content-Type": mime(".html") })
			if (stats.isDirectory()) {
				fs.readdir(filepath, (err, files) => {
					if (err) {
						errorResponse(address, url.pathname, response, err)
					} else {
						logConnetion(address, url.pathname, 200)
						files.sort()
						var finish = () => {
							var filesSorted = Object.keys(fileTags).sort()
							filesSorted.forEach((v) => {
								if (lastLetter != v[0].toUpperCase()) {
									lastLetter = v[0].toUpperCase()
									response.write("<b>" + lastLetter + ":</b><br />")
								}
								response.write(fileTags[v])
							})
							response.end("</body></html>")
						}
						var done = 0
						var lastLetter = ""
						var fileTags = {}
						response.writeHead(200, codes[200].name, { "Content-Type": mime(".html") })
						response.write("<html><head><title>Directory Listing</title></head><body><h1>Directory Listing</h1><br />")
						files.forEach(v => {
							var fullPath = path.join(filepath, v)
							fs.stat(fullPath, (err, stat) => {
								if (err) {
									fileTags[v] = (B.escapeHTML(err.stack + "\n"))
								} else {
									var href = (url.pathname.length > 1) ? url.pathname + "/" + v : v;
									if (stat.isDirectory()) {
										fileTags[v] = ("<a href=\""+ href +"\" style=\"color:blue\">" + B.escapeHTML(v) + "</a><br />")
									} else {
										if ([".html", ".txt"].indexOf(path.extname(v)) != -1) {
											fileTags[v] = ("<a href=\"" + href + "\" style=\"color:black\">" + B.escapeHTML(v) + "</a><br />")
										} else {
											fileTags[v] = ("<a href=\"" + href + "\" style=\"color:red\">" + B.escapeHTML(v) + "</a><br />")
										}
									}
								}
								done++
								if (done >= files.length) {
									finish()
								}
							})
						})
					}
				})
			} else {
				fs.readFile(filepath, (err, data) => {
					if (err) {
						errorResponse(address, url.pathname, response, err)
					} else {
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
}
