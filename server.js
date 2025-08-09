const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const EMOJIS = [
    '😀', '😎', '🤖', '👽', '🦄', '🐉', '🔥', '⚡', '🌟', '💎',
    '🍕', '🍔', '🍟', '🍩', '🍰', '🍭', '🎮', '🎯', '🎪', '🎨',
    '🚀', '🛸', '🚗', '🏎️', '🚲', '🛴', '🦋', '🐸', '🐙', '🦑'
];

class Game {
    constructor() {
        this.players = new Map();
        this.food = [];
        this.gameWidth = 3000;
        this.gameHeight = 3000;
        this.foodCount = 200;
        this.generateFood();
    }

    generateFood() {
        this.food = [];
        for (let i = 0; i < this.foodCount; i++) {
            this.food.push({
                x: Math.random() * this.gameWidth,
                y: Math.random() * this.gameHeight,
                emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
                size: 5
            });
        }
    }

    addPlayer(socketId, name) {
        const player = {
            id: socketId,
            name: name,
            x: Math.random() * this.gameWidth,
            y: Math.random() * this.gameHeight,
            vx: 0,
            vy: 0,
            size: 20,
            emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
            color: `hsl(${Math.random() * 360}, 70%, 60%)`,
            score: 0,
            speed: 3,
            acceleration: 0.3,
            friction: 0.95,
            trail: []
        };
        this.players.set(socketId, player);
        return player;
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
    }

    updatePlayer(socketId, mouseX, mouseY) {
        const player = this.players.get(socketId);
        if (!player) return;

        // Вычисляем направление движения
        const dx = mouseX - player.x;
        const dy = mouseY - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 5) {
            // Ускорение в направлении цели (как в Spore)
            const targetVx = (dx / distance) * player.speed;
            const targetVy = (dy / distance) * player.speed;
            
            player.vx += (targetVx - player.vx) * player.acceleration;
            player.vy += (targetVy - player.vy) * player.acceleration;
        } else {
            // Замедление при приближении к цели
            player.vx *= player.friction;
            player.vy *= player.friction;
        }

        // Применяем трение
        player.vx *= player.friction;
        player.vy *= player.friction;

        // Обновляем позицию
        player.x += player.vx;
        player.y += player.vy;

        // Ограничиваем движение в пределах игрового поля
        player.x = Math.max(player.size, Math.min(this.gameWidth - player.size, player.x));
        player.y = Math.max(player.size, Math.min(this.gameHeight - player.size, player.y));

        // Обновляем след (хвост)
        player.trail.push({ x: player.x, y: player.y, size: player.size * 0.8 });
        if (player.trail.length > 15) {
            player.trail.shift();
        }
    }

    checkCollisions() {
        const playersArray = Array.from(this.players.values());
        
        for (let i = 0; i < playersArray.length; i++) {
            const player1 = playersArray[i];
            
            // Проверяем поедание еды
            for (let j = this.food.length - 1; j >= 0; j--) {
                const foodItem = this.food[j];
                const distance = Math.sqrt(
                    Math.pow(player1.x - foodItem.x, 2) + 
                    Math.pow(player1.y - foodItem.y, 2)
                );
                
                if (distance < player1.size + foodItem.size) {
                    player1.size += 1;
                    player1.score += 10;
                    player1.speed = Math.max(1, 3 - player1.size * 0.02);
                    this.food.splice(j, 1);
                    
                    this.food.push({
                        x: Math.random() * this.gameWidth,
                        y: Math.random() * this.gameHeight,
                        emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
                        size: 5
                    });
                }
            }
            
            // Проверяем поедание других игроков
            for (let j = 0; j < playersArray.length; j++) {
                if (i === j) continue;
                
                const player2 = playersArray[j];
                const distance = Math.sqrt(
                    Math.pow(player1.x - player2.x, 2) + 
                    Math.pow(player1.y - player2.y, 2)
                );
                
                if (distance < player1.size && player1.size > player2.size * 1.2) {
                    player1.size += player2.size * 0.5;
                    player1.score += player2.score + 100;
                    player1.emoji = player2.emoji;
                    player1.speed = Math.max(1, 3 - player1.size * 0.02);
                    
                    player2.x = Math.random() * this.gameWidth;
                    player2.y = Math.random() * this.gameHeight;
                    player2.size = 20;
                    player2.emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
                    player2.score = 0;
                    player2.speed = 3;
                    player2.vx = 0;
                    player2.vy = 0;
                    player2.trail = [];
                    
                    io.emit('playerEaten', {
                        eater: player1.name,
                        eaten: player2.name,
                        eaterEmoji: player1.emoji
                    });
                }
            }
        }
    }

    getState() {
        return {
            players: Array.from(this.players.values()),
            food: this.food,
            gameWidth: this.gameWidth,
            gameHeight: this.gameHeight
        };
    }
}

const game = new Game();

io.on('connection', (socket) => {
    console.log('Новый игрок подключился:', socket.id);

    socket.on('joinGame', (name) => {
        const player = game.addPlayer(socket.id, name);
        socket.emit('playerJoined', player);
    });

    socket.on('playerMove', (data) => {
        game.updatePlayer(socket.id, data.mouseX, data.mouseY);
    });

    socket.on('disconnect', () => {
        console.log('Игрок отключился:', socket.id);
        game.removePlayer(socket.id);
    });
});

setInterval(() => {
    game.checkCollisions();
    io.emit('gameState', game.getState());
}, 1000 / 60);

app.use(express.static(path.join(__dirname, 'public')));

server.listen(3000, () => {
    console.log('Сервер запущен на http://localhost:3000');
});