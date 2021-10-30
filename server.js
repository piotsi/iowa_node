var express         = require('express');
var session         = require('express-session')
const Sequelize     = require('sequelize')
const WebSocket     = require('ws');
const cors          = require('cors');
const e = require('express');
var app             = express();
var PORT            = process.env.PORT || 8080;
var server          = app.listen(PORT,() => console.log(`Listening on ${ PORT }`));

const sequelize = new Sequelize('database', 'root', 'root', {
    dialect: 'sqlite',
    storage: 'orm-db.sqlite',
});

const sessionParser = session({
    saveUninitialized: false,
    secret: '$secret',
    resave: false
});

const wss = new WebSocket.Server({
	noServer: true,
});

app.use(express.json());
app.use(cors());
app.use(sessionParser);
app.use(express.static(__dirname + '/static/'));
app.use(sessionParser);

let onlineUsers = {};

const Users = sequelize.define('users', {
    user_id: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    user_name: Sequelize.STRING,
    user_password: Sequelize.STRING
})

const Messages = sequelize.define('messages', {
    message_id: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
	message_from_user_id: Sequelize.INTEGER,
	message_to_user_id: Sequelize.INTEGER,
	message_text: Sequelize.STRING
})

sequelize.sync({ force: true }).then(() => {
  console.log(`Database & tables created!`)
})


function testGet(request, response){
    response.send("testGet working");
}

async function register(request, response) {
    let user_name = request.body.user_name;
    let user_password = request.body.user_password;
    if (user_name && user_password) {
		const count = await Users.count({ where: { user_name: user_name } });
		if (count != 0) {
			response.send({ register: false });
		} else {
			try {
				await Users.create({user_name: user_name, user_password: user_password});
				response.send({ register: true });
			} catch (error) {
				console.error(error);
				response.send({ register: false });
			}
		}
    } else {
        response.send({ register: false });
    }
}

async function login(request, response) {
    let user_name = request.body.user_name;
    let user_password = request.body.user_password;
    if (user_name && user_password) {
		try {
			const user = await Users.findOne({
				where: {
					user_name: user_name,
					user_password: user_password
				}
			});
			if (user) {
				request.session.loggedin = true;
				request.session.user_id = user.user_id;
			} else if (!request.session.loggedin) {
				request.session.loggedin = false;
			}
			response.send({ loggedin: request.session.loggedin, user_name: user.user_name, user_id: request.session.user_id });
		} catch (error) {
			request.session.loggedin = false;
			response.send({ loggedin: request.session.loggedin });
		}
    } else {
		request.session.loggedin = false;
		response.send({ loggedin: request.session.loggedin });
    }
}

function loginTest(request, response) {
    response.send({ loggedin: true });
}

async function logout(request, response) {
    let user_name = request.body.user_name;
    let user_password = request.body.user_password;
    if (user_name && user_password) {
		try {
			const user = await Users.findOne({
				where: {
					user_name: user_name,
					user_password: user_password
				}
			});
			if (user) {
				request.session.loggedin = false;
			}
			response.send({ loggedin: request.session.loggedin });
		} catch (error) {
			request.session.loggedin = false;
			response.send({ loggedin: request.session.loggedin });
		}
    } else {
		request.session.loggedin = false;
		response.send({ loggedin: request.session.loggedin });
    }
}

function checkSessions(request, response, next) {
    if (request.session.loggedin) {
        next();
    } else {
        response.send({ loggedin: false });
    }
}

async function getUsers(request, response) {
	let usersNew = [{}];
	try {
		const users = await Users.findAll();
		for (let i = 0; i < users.length; i++) {
			usersNew[i] = {user_name: users[i].user_name, user_id: users[i].user_id, online: onlineUsers[users[i].user_id] ? true : false}
		}
		response.send({ data: usersNew });
	} catch (error) {
		response.send({ data: [] });
	}
}


async function sendMessages(request, response) {
	let message_text = request.body.message_text;
    let to = request.body.message_to_user_id;
	let from = request.session.user_id;
	let mes = {
		message_from_user_id: from,
		message_to_user_id: to,
		message_text: message_text,
	}
	console.log(`Received message => ${message_text} from ${from} to ${to}`);

	try {
		user = await Users.findOne({ where: { user_id: to }});
		if (user) {
			try {
				message = await Messages.create(mes);
				if (user.user_id in onlineUsers) {
					// Send message to user
					wss.clients.forEach(function each(client) {
						if (client.readyState === WebSocket.OPEN && client.user_id === mes.message_to_user_id) {
							client.send(mes.message_text);
						}
					});

				}
				if (mes.message_from_user_id !== mes.message_to_user_id) {
					if (mes.message_from_user_id in onlineUsers) {
						 // Send message to ourselfs when user doesn't send a message. ???
						console.log(mes)
					}
				}
				response.send({ sending: true });
			} catch (error) {
				console.log(error);
				response.send({ error: error })
			}
		} else {
			response.send({ error: "User not exists" });
		}
	} catch (error) {
		console.log(error);
		response.send({ error: error });
	}
}

async function getMessages(request, response) {
	let id = request.params.id;
	let from = request.session.user_id;
    console.log(`Getting messages to user_id ${id} from user_id ${from}`);
	try {
		messages = await Messages.findAll({ where: { message_to_user_id: id, message_from_user_id: from }})
		if (messages.length > 0) {
			let messagesNew = [{}];
			for (let i = 0; i < messages.length; i++) {
				let message = messages[i];
				messagesNew[i] = {
					message_from_user_id: message.message_from_user_id,
					message_to_user_id: message.message_to_user_id,
					message_text: message.message_text,
					message_date: message.createdAt
				};
			}
			response.send({ messages: messagesNew });
		} else {
			response.send({ error: "No messages found" });
		}
	} catch (error) {
		console.log(error)
		response.send({ error: error });
	}
}

app.get('/api/test-get', testGet);
app.post('/api/register/', [register]);
app.post('/api/login/', [login]);
app.get('/api/login-test/', [checkSessions, loginTest]);
app.get('/api/logout/', [checkSessions, logout]);
app.get('/api/users/', [checkSessions, getUsers]);
app.post('/api/messages/', [checkSessions, sendMessages]);
app.get('/api/messages/:id', [checkSessions, getMessages]);

server.on('upgrade', function (request, socket, head) {
	sessionParser(request, {}, function(){
		if (!request.session.user_id) {
			socket.destroy();
			return;
		}
		wss.handleUpgrade(request, socket, head, function (ws) {
			wss.emit('connection', ws, request);
		});
    });
});

wss.on('connection', function (ws, request) {
    wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ status: 2 }));
			client.user_id = request.session.user_id;
        }
    });
	if (request.session) {
		onlineUsers[request.session.user_id] = ws;
	} else {
		return;
	}

    ws.on('message', function (message) {
        console.log(message.toString())
        try {
            var data = JSON.parse(message);
        } catch (error) {
            return;
        }
    });

    ws.on('close', () => {
        delete onlineUsers[request.session.user_id];
    })
});
