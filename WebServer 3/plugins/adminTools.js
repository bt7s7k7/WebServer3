B.log("Admin tools initializing...");
var fs = require("fs")
var path = require("path")
var password = null

function handleConnection(request, response, address, url, filepath, files, handled) {
	var cookies = B.parseQuery(request.headers.cookie, /;\s*?/)
	var query = B.parseQuery(url.query)

	if (cookies.adminTools_password == password) {
		writeIndex(request, response, address, url, filepath, files, () => {
			response.write(`<br /><form method="post" action="/_action?upload=${encodeURIComponent(url.pathname)}&redirect=${encodeURIComponent(url.pathname)}" enctype="multipart/form-data"><input type="file" name="upload" /><input type="submit" /></form>`)
		}, "Admin Directory Listing", (href, stat, name) => {
			var ahref = `/_action?delete=${encodeURIComponent(href)}&redirect=${encodeURIComponent(url.pathname)}`
			if (stat && stat.isDirectory()) {
				return (`<a href="${href}" style="color:blue">${B.escapeHTML(name)}</a> : <a href="${ahref}">&#128465;</a><br />`)
			} else {
				if ([".html", ".txt"].indexOf(path.extname(name)) != -1) {
					return (`<a href="${href}" style="color:black">${B.escapeHTML(name)}</a> : <a href="${ahref}">&#128465;</a><br />`)
				} else {
					return (`<a href="${href}" style="color:red">${B.escapeHTML(name)}</a> : <a href="${ahref}">&#128465;</a><br />`)
				}
			}
		})
	} else {
		writeIndex(request, response, address, url, filepath, files, () => {
			response.write(`<br /><a href="/_login?redirect=${encodeURIComponent(url.pathname)}"><button>Log in</button></a>`)
		})
	}
	handled()

}

B.loadCfgFile(path.join(__dirname, "plugins\\adminTools.cfg"), {
	password: "string"
}, (err, data) => {
	if (err) {
		throw err
	}
	debugger
	password = data.password
	pluginEmitter.on("index", handleConnection)
	pluginEmitter.on("connection", (request, response, address, url, filepath, handled) => {
		if (url.pathname == "/_login" || url.pathname == "/_action") {
			handled()
			B.readAllData(request, (err, data) => {
				var cookies = B.parseQuery(request.headers.cookie, /;\s*?/)
				var query = B.parseQuery(url.query)
				var post
				try {
					post = B.parseQuery(data.toString(), /;\s*?/)
				} catch (err) {
					post = {}
				}
				if (url.pathname == "/_login") {
					if (post.password == password) {
						cookies.adminTools_password = password
						response.setHeader("Set-Cookie", "adminTools_password=" + password)
					}

					if (cookies.adminTools_password == password) {
						if ("redirect" in query) {
							writeRedirect(response, query.redirect)
						} else {
							response.end(`
							<html>
								<head>
									<title>Log In</title>
								</head>
								<body>
									<h1>Logged In</h1><br />
									Goto <a href="/">index</a>. To sign off restart client.
								</body>
							</html>
							`
							)
						}
					} else {
						response.write(`
						<html>
							<head>
								<title>Log In</title>
							</head>
							<body>
								<h1>Please log in</h1><br />
						`
						)
						if ("password" in post) {
							response.write(`<span style="color: red">Wrong password</span><br />`)
						}

						response.end(`
								<form method="post" action="">
									<input name="password" type="password" /><input type="submit">
								</form>
							</body>
						</html>
						`
						)
					}
				} else if (url.pathname == "/_action") {
					if (cookies.adminTools_password == password) {
						if (query.delete) {
							let filepath = path.join(serverDir, decodeURIComponent(query.delete))
							fs.unlink(filepath, (err) => {
								if (err) {
									B.log(err.stack)
								}
								writeRedirect(response, query.redirect || "/")
							})
						}

						if (query.upload) {
							let filepath = path.join(serverDir, decodeURIComponent(query.upload))
							let fileData = data.slice(data.indexOf(new Buffer("\r\n\r\n")) + 4, data.lastIndexOf(new Buffer("\r\n")))
							fileData = fileData.slice(0, fileData.lastIndexOf(new Buffer("\r\n")))
							let cDisp = data.slice(data.indexOf(new Buffer("\r\n")) + 2)
							cDisp = cDisp.slice(32, cDisp.indexOf(new Buffer("\r\n"))).toString()
							let metadata = B.parseQuery(cDisp.toString(), /;\s*?/)
							fs.writeFile(path.join(filepath, metadata.filename.slice(1, -1)), fileData, (err) => {
								if (err) B.log(err)
								writeRedirect(response, query.redirect || "/")
							})
						}
					} else {
						writeRedirect(response, query.redirect || "/")
					}
				}
			})
		}
	})
})
