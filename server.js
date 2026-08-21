// package.json: 
// { 
//   "name": "nature-guardians", 
//   "dependencies": { 
//     "express": "4.18", 
//     "socket.io": "4.6", 
//     "better-sqlite3": "9.0" 
//   } 
// }

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const hrtime = require('process').hrtime;

const PORT = 3000;
const TICK_RATE = 50; // 20Hz
const WORLD_W = 3000;
const WORLD_H = 3000;
const MAX_ROOM = 10;
const BOT_COUNT = 5;
const SPEED = 4;
const ATTACK_RANGE = 60;
const ATTACK_DMG = 10;

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = new Database('game.db');

// Initialize database schema
db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE,
  level INTEGER DEFAULT 0,
  xp INTEGER DEFAULT 0,
  allTimeScore INTEGER DEFAULT 0,
  gamesPlayed INTEGER DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  playerId INTEGER,
  score INTEGER,
  xp INTEGER,
  duration INTEGER,
  endedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (playerId) REFERENCES players(id)
);
`);

// Player Class
class Player {
    constructor(id, username) {
        this.id = id;
        this.username = username;
        this.x = Math.random() * WORLD_W;
        this.y = Math.random() * WORLD_H;
        this.level = 0;
        this.xp = 0;
        this.allTimeScore = 0;
    }
}

// Bot Class
class Bot {
    constructor(id) {
        this.id = id;
        this.state = 'idle'; // idle, wander, chase, attack, flee
        this.target = null; // Target player
        this.x = Math.random() * WORLD_W;
        this.y = Math.random() * WORLD_H;
    }

    update(players) {
        // Implement AI behavior with real movement calculations
        switch (this.state) {
            case 'idle':
                this.offerWander();
                break;
            case 'wander':
                this.wander();
                break;
            case 'chase':
                this.chase();
                break;
            case 'attack':
                this.attack();
                break;
            case 'flee':
                this.flee();
                break;
        }
    }

    offerWander() {
        // Logic to wander around
        this.state = 'wander';
    }

    wander() {
        // Wandering logic
        console.log(`${this.id} is wandering`);
    }

    chase() {
        // Chase a target player
        console.log(`${this.id} is chasing`);
    }

    attack() {
        // Attack logic
        console.log(`${this.id} attacked the target`);
    }

    flee() {
        // Flee logic
        console.log(`${this.id} is fleeing`);
    }
}

// Room Class
class Room {
    constructor(id) {
        this.id = id;
        this.players = new Map(); // Map of players in the room
        this.bots = [];
        this.active = false;
        this.emptyTimer = null;
    }

    addPlayer(player) {
        this.players.set(player.id, player);
        // Set the player's room info
        this.bots.push(new Bot(this.bots.length)); // Add bots on player join
        if (this.players.size === 1) this.startGameLoop();
    }

    removePlayer(player) {
        this.players.delete(player.id);
        if (this.players.size === 0) {
            clearTimeout(this.emptyTimer);
            this.emptyTimer = setTimeout(() => this.destroy(), 30000);
        }
    }

    startGameLoop() {
        this.active = true;
        this.gameLoop();
    }

    gameLoop() {
        const loop = hrtime();
        setInterval(() => {
            const tickTime = hrtime(loop);
            // Update players and bots, emit game state
            this.bots.forEach(bot => bot.update(this.players));
            this.broadcastState();
        }, 1000 / TICK_RATE);
    }

    broadcastState() {
        const state = {
            players: Array.from(this.players.values()),
            bots: this.bots,
        };
        io.to(this.id).emit('gameState', state);
    }

    destroy() {
        this.active = false;
        console.log(`Room ${this.id} destroyed.`);
    }
}

// Room Manager class
class RoomManager {
    constructor() {
        this.rooms = new Map(); // Map of all rooms
    }

    findOrCreateRoom() {
        // Create or find an available room
        let availableRoom = null;
        for (const room of this.rooms.values()) {
            if (room.players.size < MAX_ROOM) {
                availableRoom = room;
                break;
            }
        }
        if (!availableRoom) {
            const newRoomId = `room_${this.rooms.size + 1}`;
            availableRoom = new Room(newRoomId);
            this.rooms.set(newRoomId, availableRoom);
        }
        return availableRoom;
    }

    destroyRoom(id) {
        const room = this.rooms.get(id);
        if (room) {
            room.destroy();
            this.rooms.delete(id);
        }
    }
}

const roomManager = new RoomManager();

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    
    socket.on('joinRoom', (data) => {
        const { username } = data;
        const room = roomManager.findOrCreateRoom();
        const player = new Player(socket.id, username);
        room.addPlayer(player);

        socket.currentRoomId = room.id;
        socket.currentPlayerId = player.id;

        socket.join(room.id);
        socket.emit('roomJoined', { roomId: room.id, players: Array.from(room.players.values()) });
    });

    socket.on('playerInput', (data) => {
        const { dx, dy } = data;
        const room = roomManager.rooms.get(socket.currentRoomId);

        if (!room) return;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return; // Normalize inputs

        const player = room.players.get(socket.currentPlayerId);
        if (!player) return;

        player.x += dx * SPEED;
        player.y += dy * SPEED;
        room.broadcastState();
    });

    socket.on('respawn', () => {
        const room = roomManager.rooms.get(socket.currentRoomId);
        if (!room) return;

        const player = new Player(socket.id, room.players.get(socket.currentPlayerId).username);
        room.addPlayer(player);
        socket.currentPlayerId = player.id; // Update playerId after respawn
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const room = roomManager.rooms.get(socket.currentRoomId);
        if (!room) return;
        room.removePlayer({ id: socket.currentPlayerId });
    });
});

app.use(express.static('public')); // Serve static assets
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});