"use strict";

const { SerialPort } = require('serialport');
const { InterByteTimeoutParser } = require('@serialport/parser-inter-byte-timeout');
const sqlite3 = require('sqlite3').verbose();
const fs = require('node:fs');

const timeOut = 8;

var ErgoBike = function (serialDevice, sqliteLogDB) {
  this.buffer = [];
  this.countDown = timeOut;

  this.logSession = 0;
  this.logSeq = 0;
  this.logDuration = 0;
  this.db = null;
  this.stmt = null;
  this.reqTime = 0;
  this.prevDuration = 0;

  this.clock = false;
  this.clockEventUTC = 0;
  this.elapsedTime = 0;

  this.speed = 0;
  this.speedEventUTC = Date.now();
  this.elapsedDistance = 0;

  for (let i = 0; i < 19; ++i) {
    this.buffer[i] = 0;
  }

  if (sqliteLogDB) {
    this.db = new sqlite3.Database(sqliteLogDB, (err) => {
      if (err) {
        return console.error(err.message);
      }
      console.log('Connected to SQlite database "' + sqliteLogDB + '".');
      this.db.serialize(() => {
        this.db.run('CREATE TABLE IF NOT EXISTS session(sessionId INTEGER PRIMARY KEY, TIMESTAMP DATETIME DEFAULT(STRFTIME(\'%Y-%m-%d %H:%M:%f\', \'NOW\')))');
        this.db.run('CREATE TABLE IF NOT EXISTS log(sessionId INTEGER, seq INTEGER, program NUMBER, person NUMBER, power NUMBER, cadence NUMBER,speed NUMBER, distance NUMBER, duration NUMBER, work NUMBER, realWork NUMBER, puls NUMBER, pulsState NUMBER, gear NUMBER)');
        this.stmt = this.db.prepare('INSERT INTO log(sessionId,seq,program,person,power,cadence,speed,distance,duration,work,realWork,puls,pulsState,gear) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      });
    });
  }

  this.initSerialPort(serialDevice);
  setInterval(this.requestStatus.bind(this), 1000);
  setInterval(() => {
    process.stdout.write(this.port && this.port.isOpen ? '.' : 'x');
  }, 1000);
};

ErgoBike.prototype.initSerialPort = function (serialDevice) {
  const reconnectDelay = 3000;

  const connect = () => {
    console.log(`Connecting to serial device ${serialDevice}...`);
    this.port = new SerialPort({
      path: serialDevice,
      baudRate: 9600,
      autoOpen: false,
    });

    this.port.open((err) => {
      if (err) {
        console.error('\x1b[31m[ERROR]\x1b[0m Failed to open serial port:', err.message);
        setTimeout(connect, reconnectDelay);
        return;
      }
      console.log('\x1b[32m[SUCCESS]\x1b[0m Serial port opened.');

      this.parser = this.port.pipe(new InterByteTimeoutParser({ interval: 50 }));
      this.parser.on('data', this.handleData.bind(this));

      this.port.on('error', (err) => {
        console.error('\x1b[31m[ERROR]\x1b[0m Serial port error:', err.message);
      });

      this.port.on('close', () => {
        console.warn('\x1b[33m[WARN]\x1b[0m Serial port closed. Attempting reconnect...');
        setTimeout(connect, reconnectDelay);
      });
    });
  };

  connect();
};

ErgoBike.prototype.handleData = function (data) {
  this.reqTime = Date.now() - this.reqTime;
  this.buffer = data;

  if ((this.clockEventUTC <= 0) || (this.getDuration() <= 0)) {
    this.clock = false;
    this.clockEventUTC = Date.now();
    this.elapsedTime = this.getDuration();
    this.speedEventUTC = Date.now();
    this.speed = this.getSpeed();
    this.elapsedDistance = this.getDistance();
  }

  if (!this.clock && (this.getPedal() || this.getSpeed())) {
    this.clockEventUTC = Date.now();
    this.clock = true;
  } else if (this.clock && !(this.getPedal() || this.getSpeed())) {
    this.elapsedTime += (Date.now() - this.clockEventUTC);
    this.clockEventUTC = Date.now();
    this.clock = false;
  }

  if (this.getSpeed() != this.speed) {
    const now = Date.now();
    this.elapsedDistance += (this.speed * (now - this.speedEventUTC) / 1000);
    this.speedEventUTC = now;
    this.speed = this.getSpeed() / 3.6;
  }

  this.countDown = timeOut;
  this.logRaw();
  if (this.getSpeed() && this.db) {
    this.logDB();
  }
};

ErgoBike.prototype.logRaw = function () {
  const timestamp = new Date().toISOString();
  let line = timestamp;
  this.buffer.forEach(item => {
    line += ',' + item;
  });
  fs.appendFile('ergobike.log', line + '\r\n', { flush: true }, err => {
    if (err) {
      console.error('[LOG ERROR]', err);
    }
  });
};

ErgoBike.prototype.requestStatus = function () {
  if (this.countDown > 0) {
    if (--this.countDown == 0) {
      this.buffer[3] = 0;
      this.buffer[6] = 0;
      this.buffer[7] = 0;
    }
  }

  if (this.port && this.port.isOpen) {
    const data = [0x40, 0x00];
    this.port.write(data);
    this.port.drain();
    this.reqTime = Date.now();
  }
};

ErgoBike.prototype.logCon = function () {
  console.log('Program: %d  Person: %d  Pedal: %d  Power: %d W  Cadence: %d rpm  Speed=%d km/h  Distance: %d m  Duration: %d  Work: %d J  Puls: %d  PulsState: %d  Gear: %d  realWork: %d J',
    this.getProgram(), this.getPerson(), this.getPedal(), this.getPower(), this.getCadence(), this.getSpeed(), this.getDistance(), this.getDuration(),
    this.getWork(), this.getPuls(), this.getPulsState(), this.getGear(), this.getRealWork());
};

ErgoBike.prototype.logDB = function () {
  if (this.getSpeed()) {
    if (this.db) {
      if ((this.logSession == 0) || (this.logDuration > this.getDuration())) {
        this.db.serialize(() => {
          this.db.exec('INSERT INTO session (sessionId) VALUES (NULL)');
          this.db.get("SELECT MAX(sessionId) sessionId FROM session", (err, row) => {
            this.logSession = row.sessionId;
            this.logSeq = 0;
            this.stmt.run(this.logSession, ++this.logSeq, this.getProgram(), this.getPerson(), this.getPower(), this.getCadence(), this.getSpeed(), this.getDistance(), this.logDuration, this.getWork(), this.getRealWork(), this.getPuls(), this.getPulsState(), this.getGear());
          });
        });
      } else {
        this.stmt.run(this.logSession, ++this.logSeq, this.getProgram(), this.getPerson(), this.getPower(), this.getCadence(), this.getSpeed(), this.getDistance(), this.logDuration, this.getWork(), this.getRealWork(), this.getPuls(), this.getPulsState(), this.getGear());
      }
      this.logDuration = this.getDuration();
    }
  }
};

ErgoBike.prototype.getProgram = function () { return this.buffer[2]; };
ErgoBike.prototype.getPerson = function () { return this.buffer[3]; };
ErgoBike.prototype.getPedal = function () { return this.buffer[4]; };
ErgoBike.prototype.getPower = function () { return this.buffer[5] * 5; };
ErgoBike.prototype.getCadence = function () { return this.buffer[4] ? this.buffer[6] : 0; };
ErgoBike.prototype.getSpeed = function () { return this.buffer[7]; };
ErgoBike.prototype.getDistance = function () { return 100 * (this.buffer[9] * 0x100 + this.buffer[8]); };
ErgoBike.prototype.getDuration = function () { return (this.buffer[11] * 0x100 + this.buffer[10]); };
ErgoBike.prototype.getWork = function () { return (this.buffer[13] * 0x100 + this.buffer[12]) * 100; };
ErgoBike.prototype.getPuls = function () { return this.buffer[14]; };
ErgoBike.prototype.getPulsState = function () { return this.buffer[15]; };
ErgoBike.prototype.getGear = function () { return this.buffer[16]; };
ErgoBike.prototype.getRealWork = function () { return (this.buffer[18] * 0x100 + this.buffer[17]) * 100; };

ErgoBike.prototype.getEstimatedDistance = function () {
  if (this.clock) {
    const now = Date.now();
    return this.elapsedDistance + this.speed * ((now - this.speedEventUTC) / 1000);
  } else {
    return this.elapsedDistance;
  }
};

ErgoBike.prototype.getEstimatedDuration = function () {
  if (this.clock) {
    const now = Date.now();
    return (this.elapsedTime + (now - this.clockEventUTC)) / 1000;
  } else {
    return this.elapsedTime / 1000;
  }
};

module.exports.ErgoBike = ErgoBike;
