const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;
const GRID_SIZE = 20;
const MAX_PLAYERS = 4;
const GAME_DURATION = 10 * 60 * 1000; // 10 minutes
const FOOD_SPAWN_INTERVAL = 10000; // 10 seconds
const SPECIAL_FOOD_SPAWN_INTERVAL = 30000; // 30 seconds
const FOOD_LIFETIME = 10000; // 10 seconds

// Store all game rooms
const gameRooms = new Map();

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

class Game {
    constructor(roomCode, hostId) {
        this.roomCode = roomCode;
        this.hostId = hostId;
        this.players = new Map();
        this.food = [];
        this.specialFood = null;
        this.gameActive = false;
        this.gameStartTime = null;
        this.gameEndTime = null;
        this.foodTimer = null;
        this.specialFoodTimer = null;
        this.gameTimer = null;
        this.createdAt = Date.now();
    }

    addPlayer(socket) {
        if (this.players.size >= MAX_PLAYERS) {
            return false;
        }

        const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
        const usedColors = Array.from(this.players.values()).map(p => p.color);
        const availableColor = colors.find(color => !usedColors.includes(color));

        const startPositions = [
            { x: 100, y: 100 },
            { x: 700, y: 100 },
            { x: 100, y: 500 },
            { x: 700, y: 500 }
        ];

        const player = {
            id: socket.id,
            socket: socket,
            snake: [startPositions[this.players.size]],
            direction: { x: 1, y: 0 },
            color: availableColor,
            alive: true,
            speedBoostUntil: 0,
            score: 0
        };

        this.players.set(socket.id, player);
        return true;
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
        if (this.players.size === 0) {
            this.stopGame();
            return true; // Room should be deleted
        }

        // If host leaves, assign new host
        if (socketId === this.hostId && this.players.size > 0) {
            this.hostId = this.players.keys().next().value;
            this.broadcastToRoom('hostChanged', { newHostId: this.hostId });
        }

        return false; // Room should not be deleted
    }

    broadcastToRoom(event, data) {
        this.players.forEach(player => {
            player.socket.emit(event, data);
        });
    }

    startGame() {
        if (this.gameActive || this.players.size < 1) {
            return false;
        }

        this.gameActive = true;
        this.gameStartTime = Date.now();
        this.gameEndTime = this.gameStartTime + GAME_DURATION;

        this.spawnFood();
        this.foodTimer = setInterval(() => this.spawnFood(), FOOD_SPAWN_INTERVAL);
        this.specialFoodTimer = setInterval(() => this.spawnSpecialFood(), SPECIAL_FOOD_SPAWN_INTERVAL);

        this.gameTimer = setTimeout(() => {
            this.endGame();
        }, GAME_DURATION);

        this.gameLoop();
        return true;
    }

    stopGame() {
        this.gameActive = false;
        if (this.foodTimer) clearInterval(this.foodTimer);
        if (this.specialFoodTimer) clearInterval(this.specialFoodTimer);
        if (this.gameTimer) clearTimeout(this.gameTimer);

        this.food = [];
        this.specialFood = null;

        this.players.forEach(player => {
            player.snake = [{ x: 100, y: 100 }];
            player.direction = { x: 1, y: 0 };
            player.alive = true;
            player.speedBoostUntil = 0;
            player.score = 0;
        });
    }

    endGame() {
        this.gameActive = false;

        let winner = null;
        let maxLength = 0;

        this.players.forEach(player => {
            if (player.alive && player.snake.length > maxLength) {
                maxLength = player.snake.length;
                winner = player;
            }
        });

        this.broadcastToRoom('gameEnd', {
            winner: winner ? winner.id : null,
            finalScores: Array.from(this.players.values()).map(p => ({
                id: p.id,
                score: p.snake.length,
                alive: p.alive
            }))
        });

        setTimeout(() => {
            this.stopGame();
        }, 5000);
    }

    spawnFood() {
        // Spawn 3-5 food items randomly
        const minFood = 3;
        const maxFood = 5;
        const targetFood = Math.floor(Math.random() * (maxFood - minFood + 1)) + minFood;

        // Only spawn if we don't have enough food
        while (this.food.length < targetFood) {
            const pos = this.getRandomPosition();
            if (!this.isPositionOccupied(pos)) {
                const foodItem = {
                    ...pos,
                    spawnTime: Date.now(),
                    id: Math.random().toString(36).substr(2, 9) // Unique ID for tracking
                };
                this.food.push(foodItem);

                // Schedule food removal after 10 seconds
                setTimeout(() => {
                    this.removeExpiredFood(foodItem.id);
                }, FOOD_LIFETIME);
            }
        }
    }

    removeExpiredFood(foodId) {
        const initialLength = this.food.length;
        this.food = this.food.filter(food => food.id !== foodId);

        // Debug log to verify removal
        if (this.food.length < initialLength) {
            console.log(`Food removed. Room ${this.roomCode}: ${this.food.length} food items remaining`);
        }
    }

    spawnSpecialFood() {
        if (!this.specialFood) {
            const pos = this.getRandomPosition();
            if (!this.isPositionOccupied(pos)) {
                const specialFoodId = Math.random().toString(36).substr(2, 9);
                this.specialFood = {
                    ...pos,
                    spawnTime: Date.now(),
                    id: specialFoodId
                };

                // Schedule special food removal after 5 seconds
                setTimeout(() => {
                    if (this.specialFood && this.specialFood.id === specialFoodId) {
                        console.log(`Special food removed. Room ${this.roomCode}`);
                        this.specialFood = null;
                    }
                }, FOOD_LIFETIME);
            }
        }
    }

    getRandomPosition() {
        return {
            x: Math.floor(Math.random() * (GAME_WIDTH / GRID_SIZE)) * GRID_SIZE,
            y: Math.floor(Math.random() * (GAME_HEIGHT / GRID_SIZE)) * GRID_SIZE
        };
    }

    isPositionOccupied(pos) {
        for (let player of this.players.values()) {
            for (let segment of player.snake) {
                if (segment.x === pos.x && segment.y === pos.y) {
                    return true;
                }
            }
        }
        return false;
    }

    updatePlayer(playerId, direction) {
        const player = this.players.get(playerId);
        if (!player || !player.alive) return;

        if (direction.x !== -player.direction.x || direction.y !== -player.direction.y) {
            player.direction = direction;
        }
    }

    gameLoop() {
        if (!this.gameActive) return;

        this.players.forEach(player => {
            if (!player.alive) return;

            const head = { ...player.snake[0] };
            head.x += player.direction.x * GRID_SIZE;
            head.y += player.direction.y * GRID_SIZE;

            if (head.x < 0 || head.x >= GAME_WIDTH || head.y < 0 || head.y >= GAME_HEIGHT) {
                player.alive = false;
                return;
            }

            if (player.snake.some(segment => segment.x === head.x && segment.y === head.y)) {
                player.alive = false;
                return;
            }

            for (let otherPlayer of this.players.values()) {
                if (otherPlayer.id !== player.id && otherPlayer.alive) {
                    if (otherPlayer.snake.some(segment => segment.x === head.x && segment.y === head.y)) {
                        player.alive = false;
                        return;
                    }
                }
            }

            player.snake.unshift(head);

            let ate = false;
            this.food = this.food.filter(food => {
                if (food.x === head.x && food.y === head.y) {
                    ate = true;
                    player.score++;
                    return false;
                }
                return true;
            });

            if (this.specialFood && this.specialFood.x === head.x && this.specialFood.y === head.y) {
                ate = true;
                player.score += 2;
                player.speedBoostUntil = Date.now() + 5000;
                this.specialFood = null;
            }

            if (!ate) {
                player.snake.pop();
            }
        });

        const alivePlayers = Array.from(this.players.values()).filter(p => p.alive);
        if (alivePlayers.length === 0 || (alivePlayers.length <= 1 && this.players.size > 1)) {
            this.endGame();
            return;
        }

        this.broadcastToRoom('gameState', {
            players: Array.from(this.players.values()).map(p => ({
                id: p.id,
                snake: p.snake,
                color: p.color,
                alive: p.alive,
                score: p.snake.length,
                speedBoost: p.speedBoostUntil > Date.now()
            })),
            food: this.food,
            specialFood: this.specialFood,
            timeLeft: Math.max(0, this.gameEndTime - Date.now())
        });

        const baseSpeed = 150;

        // Check if any players have speed boost active
        let hasSpeedBoost = false;
        for (let player of this.players.values()) {
            if (player.alive && player.speedBoostUntil > Date.now()) {
                hasSpeedBoost = true;
                break;
            }
        }

        // Increase speed significantly during speed boost (from 150ms to 75ms)
        const currentSpeed = hasSpeedBoost ? Math.floor(baseSpeed / 2) : baseSpeed;
        setTimeout(() => this.gameLoop(), currentSpeed);
    }
}

// Clean up empty rooms every 30 minutes
setInterval(() => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    gameRooms.forEach((game, roomCode) => {
        if (game.players.size === 0 || (now - game.createdAt > oneHour)) {
            game.stopGame();
            gameRooms.delete(roomCode);
            console.log(`Deleted empty/old room: ${roomCode}`);
        }
    });
}, 30 * 60 * 1000);

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    let currentRoom = null;

    socket.emit('connected', { playerId: socket.id });

    socket.on('createRoom', () => {
        let roomCode;
        do {
            roomCode = generateRoomCode();
        } while (gameRooms.has(roomCode));

        const game = new Game(roomCode, socket.id);
        gameRooms.set(roomCode, game);
        currentRoom = roomCode;

        const joined = game.addPlayer(socket);
        if (joined) {
            socket.join(roomCode);
            socket.emit('roomCreated', {
                roomCode: roomCode,
                isHost: true
            });
            socket.emit('joined', {
                success: true,
                roomCode: roomCode,
                isHost: true
            });

            game.broadcastToRoom('playersUpdate', {
                playerCount: game.players.size,
                maxPlayers: MAX_PLAYERS,
                roomCode: roomCode
            });

            console.log(`Room created: ${roomCode} by ${socket.id}`);
        }
    });

    socket.on('joinRoom', (data) => {
        const roomCode = data.roomCode.toUpperCase();
        const game = gameRooms.get(roomCode);

        if (!game) {
            socket.emit('joined', {
                success: false,
                reason: 'Room not found'
            });
            return;
        }

        if (game.gameActive) {
            socket.emit('joined', {
                success: false,
                reason: 'Game already in progress'
            });
            return;
        }

        const joined = game.addPlayer(socket);
        if (joined) {
            currentRoom = roomCode;
            socket.join(roomCode);
            socket.emit('joined', {
                success: true,
                roomCode: roomCode,
                isHost: socket.id === game.hostId
            });

            game.broadcastToRoom('playersUpdate', {
                playerCount: game.players.size,
                maxPlayers: MAX_PLAYERS,
                roomCode: roomCode
            });

            console.log(`Player ${socket.id} joined room: ${roomCode}`);
        } else {
            socket.emit('joined', {
                success: false,
                reason: 'Room is full'
            });
        }
    });

    socket.on('startGame', () => {
        if (!currentRoom) return;

        const game = gameRooms.get(currentRoom);
        if (!game || socket.id !== game.hostId) {
            socket.emit('error', { message: 'Only the host can start the game' });
            return;
        }

        const started = game.startGame();
        if (started) {
            game.broadcastToRoom('gameStarted', {});
        }
    });

    socket.on('move', (direction) => {
        if (!currentRoom) return;

        const game = gameRooms.get(currentRoom);
        if (game) {
            game.updatePlayer(socket.id, direction);
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);

        if (currentRoom) {
            const game = gameRooms.get(currentRoom);
            if (game) {
                const shouldDeleteRoom = game.removePlayer(socket.id);

                if (shouldDeleteRoom) {
                    gameRooms.delete(currentRoom);
                    console.log(`Deleted empty room: ${currentRoom}`);
                } else {
                    game.broadcastToRoom('playersUpdate', {
                        playerCount: game.players.size,
                        maxPlayers: MAX_PLAYERS,
                        roomCode: currentRoom
                    });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Snake game server running on port ${PORT}`);
});