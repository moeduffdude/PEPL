/**
 * Moe Szyslak
 *
 * December, 2014 --- send-off
 *
 * P-EPL
 */

var http = require('http');
var path = require('path');
var express = require('express');
var connect = require('connect');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var expressSession = require('express-session');
var serveFavicon = require('serve-favicon');
var pg = require('pg');
var nodemailer = require('nodemailer');
var socket = require('socket.io');
var sessionStore = require('sessionstore').createSessionStore(); // Memory
var socketHandshake = require('socket.io-handshake');
var sha1 = require('./lib/cyper');

var login = require('./routers/login');
var signup = require('./routers/signup');
var players = require('./routers/players');
var fixtures = require('./routers/fixtures');

// sockets is where we're going to keep all those sockets that are connected
// {username: socket}
var sockets = {};
var cookieSignature = 'Svi#isdf!93|4{5msVldx!fks(8}';
var emailConfig = {
  service: 'Gmail',
  auth: {
    user: 'moe.duffdude@gmail.com',
    pass: 'aardruybakmgbpmq'
  },
  from: 'Mamoe <moe.duffdude@gmail.com>',
  adminEmail: 'moe.duffdude@gmail.com'
};

var emailTransporter = nodemailer.createTransport({
  service: emailConfig.service,
  auth: emailConfig.auth
});

var pgClient = new pg.Client(process.env.DATABASE_URL || 'tcp://postgres:password@127.0.0.1:5432/pepl');
pgClient.connect();

var app = express();
app.set('port', process.env.PORT || 8000);

app.use(serveFavicon(path.join(__dirname, 'public/assets/images/favicon.ico')));
app.use(express.static(path.join(__dirname, '/public')));
app.use(expressSession({
  name: 'pepl',
  // store: sessionStore,
  secret: cookieSignature,
  cookie: {
    maxAge: 604800000, // 7 days
    secure: false, // BUY me an SSL and we can set this to true
    httpOnly: true
  },
  rolling: true,
  resave: true,
  saveUninitialized: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));



app.use('/api/login', function (request, response, next) {
  switch(request.method) {
    /**
     * tells the status of the current user
     * if session is found, current info is returned
     * which can be accessed via Auth.info()
     */
    case 'GET':
      response.status(request.session.loggedIn === true ? 200 : 412);
      response.json(request.session.loggedIn === true ? {
        player_id: request.session.player_id,
        player_username: request.session.player_username,
        player_email: request.session.player_email,
        player_type: request.session.player_type,
        player_suspended: request.session.player_suspended
      } : {});
    break;

    /**
     * login request
     * if it's all good, session is created and info is returned
     * which can be accessed via Auth.info()
     */
    case 'POST':
      pgClient.query('SELECT player_id, player_username, player_suspended, player_email, player_type FROM players WHERE (player_username=$1 OR player_email=$1) AND player_password=$2 AND player_suspended=$3', [request.body.ID.toLowerCase(), sha1(String(request.body.password)), false], function (error, result) {
        if (error) {
          response.status(409);
          response.json({});
        } else {
          if (result.rowCount === 1) {
            request.session.loggedIn = true;
            request.session.player_id = result.rows[0].player_id;
            request.session.player_username = result.rows[0].player_username;
            request.session.player_email = result.rows[0].player_email;
            request.session.player_type = result.rows[0].player_type;
            request.session.player_suspended = result.rows[0].player_suspended;

            response.status(200);
            response.json({
              player_id: result.rows[0].player_id,
              player_username: result.rows[0].player_username,
              player_email: result.rows[0].player_email,
              player_type: result.rows[0].player_type,
              player_suspended: result.rows[0].player_suspended
            });
          } else {
            response.status(401);
            response.json({});
          }
        }
      });
    break;

    /**
     * logout
     */
    case 'DELETE':
      if (request.session.loggedIn === true) {
        delete request.session.loggedIn;
        response.status(202);
      } else {
        response.status(401);
      }

      response.json({});
    break;

    default:
      response.status(405);
      response.json({});
    break;
  }
});



// app.use('/api/signup', signup({client: client, sha1: sha1, emailTransporter: emailTransporter, emailConfig: emailConfig}));
app.use('/api/signup', function (request, response, next) {
  switch(request.method) {
    case 'POST':
      /**
       * this measure is next to nothing
       * but it'll keep out the Mitches out for at-least a second :)
       * and not to mention Dyno --- 720
       */

      console.log(request.session);

      if (request.session.blockForAWeek === true) {
        response.status(403);
        response.json({});
      } else {
        pgClient.query('INSERT INTO players (player_username, player_password, player_suspended, player_email, player_type) VALUES ($1, $2, $3, $4, $5) RETURNING player_id, player_username, player_suspended, player_email, player_type;', [request.body.player_username, sha1(String(request.body.player_password)), true, request.body.player_email, 'NORMAL'], function (error, result) {
          response.status(error === null ? 202 : 409);
          response.json({});

          if (error === null) {
            console.log('setting...');
            request.session.blockForAWeek = true;
            var mailOptions = {
              from: emailConfig.from,
              to: emailConfig.adminEmail,
              subject: 'New User',
              text: 'approve or decline a Mitch',
              html: 'approve or decline a Mitch'
            };

            emailTransporter.sendMail(mailOptions, function (error, info) {
              console.log(error === null ? info : error);
            });
          }
        });
      }
    break;

    default:
      response.status(405);
      response.json({});
    break;
  }
});



/**
 * this middle fellow will check for authentication (i.e. session)
 * and will take the appropriate measures
 */
app.use(/^\/api\/.*/, function (request, response, next) {
  if (request.session.loggedIn === true) {
    next();
  } else {
    response.status(412);
    response.json({});
  }
});



app.use('/api/players/:id?/:status?', players({client: pgClient, sha1: sha1, emailTransporter: emailTransporter, emailConfig: emailConfig}));
app.use('/api/fixtures/:id?', fixtures({client: pgClient}));



// this makes sure angular is in-charge of routing
app.use(function (request, response) {
  response.sendFile(path.join(__dirname, '/public/index.html'));
});



var server = http.createServer(app);
server.listen(app.get('port'), '0.0.0.0');


// socket.io will be piggy-back riding on Express
var io = socket(server);
io.use(socketHandshake({
  store: sessionStore,
  key: 'pepl',
  secret: cookieSignature,
  parser: cookieParser()
}));


// yet another middle fellow that authenticates session
io.use(function(socket, next) {
  if (socket.handshake.session.loggedIn === true) {
    next();
  } else {
    next(new Error('not authorized'));
  }
});

// if a socket connection has established connection that means it's legit
io.on('connection', function (socket) {
  // we have a connection
  sockets[socket.handshake.session.player_username] = socket;

  // telling ERYone the good news
  // socket.broadcast.json.send({});

  // this tells everyone the sad news
  socket.on('disconnect', function () {
    delete sockets[socket.handshake.session.player_username];
    // yet another a bit too much info
    // io.emit('message', {});
  });
});
