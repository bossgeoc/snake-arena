class SnakeClient {
    constructor() {
        this.socket = io();
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.playerId = null;
        this.gameState = null;
        this.connected = false;
        this.currentRoom = null;
        this.isHost = false;
        this.isSoloMode = false;

        this.setupEventListeners();
        this.setupSocketEvents();
    }

    setupEventListeners() {
        document.addEventListener('keydown', (e) => {
            if (!this.connected || !this.gameState) return;

            let direction = null;

            switch(e.key) {
                case 'ArrowUp':
                case 'w':
                case 'W':
                    direction = { x: 0, y: -1 };
                    break;
                case 'ArrowDown':
                case 's':
                case 'S':
                    direction = { x: 0, y: 1 };
                    break;
                case 'ArrowLeft':
                case 'a':
                case 'A':
                    direction = { x: -1, y: 0 };
                    break;
                case 'ArrowRight':
                case 'd':
                case 'D':
                    direction = { x: 1, y: 0 };
                    break;
            }

            if (direction) {
                e.preventDefault();
                this.socket.emit('move', direction);
            }
        });
    }

    setupSocketEvents() {
        this.socket.on('connected', (data) => {
            this.playerId = data.playerId;
            this.connected = true;
            document.getElementById('status').textContent = "You're Connected! Choose Your Game Mode.";
            document.getElementById('soloPlayBtn').disabled = false;
            document.getElementById('createRoomBtn').disabled = false;
            document.getElementById('joinRoomBtn').disabled = false;
        });

        this.socket.on('roomCreated', (data) => {
            this.showRoomCode(data.roomCode);
        });

        this.socket.on('joined', (data) => {
            if (data.success) {
                this.currentRoom = data.roomCode;
                this.isHost = data.isHost;
                this.showGameScreen();
                this.updateRoomInfo();

                if (this.isSoloMode) {
                    document.getElementById('status').textContent = 'Solo Mode ready — press Start Game to begin!';
                    document.getElementById('startBtn').disabled = false;
                } else if (this.isHost) {
                    document.getElementById('status').textContent = 'Room created — share your code to invite friends!';
                    document.getElementById('startBtn').disabled = false;
                } else {
                    document.getElementById('status').textContent = 'Joined room! Waiting for host to start...';
                    document.getElementById('startBtn').disabled = true;
                }
            } else {
                document.getElementById('status').textContent = `Failed to join: ${data.reason}`;
            }
        });

        this.socket.on('hostChanged', (data) => {
            this.isHost = data.newHostId === this.playerId;
            this.updateRoomInfo();
            if (this.isHost) {
                document.getElementById('status').textContent = 'You are now the host!';
                document.getElementById('startBtn').disabled = false;
            }
        });

        this.socket.on('playersUpdate', (data) => {
            this.updatePlayersList(data);
        });

        this.socket.on('gameStarted', () => {
            document.getElementById('status').textContent = 'Game Started!';
            document.getElementById('startBtn').disabled = true;
        });

        this.socket.on('gameState', (gameState) => {
            this.gameState = gameState;
            this.render();
            this.updateTimer(gameState.timeLeft);
            this.updatePlayersList(null, gameState.players);
        });

        this.socket.on('gameEnd', (data) => {
            this.handleGameEnd(data);
        });

        this.socket.on('disconnect', () => {
            this.connected = false;
            document.getElementById('status').textContent = 'Disconnected from server';
            this.showLobbyScreen();
        });

        this.socket.on('error', (data) => {
            alert(data.message);
        });
    }

    showLobbyScreen() {
        document.getElementById('lobbyScreen').style.display = 'block';
        document.getElementById('gameContainer').style.display = 'none';
        this.currentRoom = null;
        this.isHost = false;
        this.isSoloMode = false;
    }

    showGameScreen() {
        document.getElementById('lobbyScreen').style.display = 'none';
        document.getElementById('gameContainer').style.display = 'flex';
    }

    updateRoomInfo() {
        if (this.currentRoom) {
            const roomCodeEl = document.getElementById('roomCode');
            const hostStatusEl = document.getElementById('hostStatus');

            if (this.isSoloMode) {
                roomCodeEl.textContent = 'Solo Mode';
                hostStatusEl.textContent = "You're playing solo";
            } else {
                roomCodeEl.innerHTML = `Room Code: ${this.currentRoom} <button class="copy-button" onclick="copyRoomCode()">Copy</button>`;
                hostStatusEl.textContent = this.isHost ? "You're the host" : 'Waiting for Host';
            }
        }
    }

    showRoomCode(roomCode) {
        if (!this.isSoloMode) {
            alert(`Room created! Share this code with your friends: ${roomCode}`);
        }
    }

    updatePlayersList(connectionData, players = null) {
        const playerList = document.getElementById('playerList');

        if (connectionData) {
            const header = `<h3>Players (${connectionData.playerCount}/${connectionData.maxPlayers})</h3>`;
            if (players) {
                // Update both header and players in one go
                const playersHtml = this.generatePlayersHtml(players);
                playerList.innerHTML = header + playersHtml;
            } else {
                playerList.innerHTML = header;
            }
        } else if (players) {
            // Keep existing header, just update players
            const existingHeader = playerList.querySelector('h3');
            const headerText = existingHeader ? existingHeader.outerHTML : '<h3>Players</h3>';
            const playersHtml = this.generatePlayersHtml(players);
            playerList.innerHTML = headerText + playersHtml;
        }
    }

    generatePlayersHtml(players) {
        return players.map(player => {
            let status = 'Still Playing';
            if (!player.alive) {
                status = 'Defeated';
            } else if (this.gameState && this.gameState.timeLeft <= 0) {
                // Game ended, check if this player won
                const alivePlayers = players.filter(p => p.alive);
                if (alivePlayers.length === 1 && player.alive) {
                    status = 'Champion';
                } else if (alivePlayers.length > 1) {
                    // Multiple survivors, check who has longest snake
                    const maxLength = Math.max(...alivePlayers.map(p => p.score));
                    status = player.score === maxLength ? 'Champion' : 'Still Playing';
                }
            }

            return `
                <div class="player-info ${!player.alive ? 'player-dead' : ''}">
                    <div class="player-color" style="background-color: ${player.color}"></div>
                    <div class="player-details">
                        <div class="player-name">Player ${player.id === this.playerId ? '(You)' : ''}</div>
                        <div class="player-stats">
                            <span class="length">Length: ${player.score}</span>
                            <span class="status">${status}</span>
                            ${player.speedBoost ? '<span class="speed-boost">SPEED!</span>' : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateTimer(timeLeft) {
        const minutes = Math.floor(timeLeft / 60000);
        const seconds = Math.floor((timeLeft % 60000) / 1000);
        document.getElementById('timer').textContent =
            `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    render() {
        if (!this.gameState) return;

        // Clear canvas with gradient background
        this.drawBackground();

        // Draw grid
        this.drawGrid();

        // Draw game elements
        this.gameState.players.forEach(player => {
            this.drawSnake(player);
        });

        this.gameState.food.forEach(food => {
            this.drawFood(food, '#ff6b6b', food.spawnTime, '🍎');
        });

        if (this.gameState.specialFood) {
            this.drawFood(this.gameState.specialFood, '#ffd700', this.gameState.specialFood.spawnTime, '⚡');
            this.drawSpecialFoodGlow(this.gameState.specialFood);
        }

        // Add screen effects
        this.drawScreenEffects();
    }

    drawBackground() {
        const gradient = this.ctx.createLinearGradient(0, 0, this.canvas.width, this.canvas.height);
        gradient.addColorStop(0, '#0a0a0a');
        gradient.addColorStop(0.5, '#1a1a1a');
        gradient.addColorStop(1, '#0a0a0a');

        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawGrid() {
        this.ctx.strokeStyle = 'rgba(0, 245, 255, 0.1)';
        this.ctx.lineWidth = 1;

        // Draw vertical lines
        for (let x = 0; x <= this.canvas.width; x += 20) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }

        // Draw horizontal lines
        for (let y = 0; y <= this.canvas.height; y += 20) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }
    }

    drawScreenEffects() {
        // Add subtle vignette effect
        const gradient = this.ctx.createRadialGradient(
            this.canvas.width / 2, this.canvas.height / 2, 0,
            this.canvas.width / 2, this.canvas.height / 2, Math.max(this.canvas.width, this.canvas.height) / 2
        );
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.3)');

        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawSnake(player) {
        player.snake.forEach((segment, index) => {
            const isHead = index === 0;
            const opacity = player.alive ? 1.0 : 0.4;

            this.ctx.save();
            this.ctx.globalAlpha = opacity;

            if (isHead) {
                // Draw head with gradient and glow
                this.drawSnakeHead(segment, player);
            } else {
                // Draw body with gradient
                this.drawSnakeBody(segment, player, index);
            }

            this.ctx.restore();
        });

        if (player.speedBoost && player.alive) {
            this.drawSpeedEffect(player);
        }
    }

    drawSnakeHead(segment, player) {
        const gradient = this.ctx.createRadialGradient(
            segment.x + 10, segment.y + 10, 0,
            segment.x + 10, segment.y + 10, 15
        );
        gradient.addColorStop(0, player.color);
        gradient.addColorStop(1, this.adjustColor(player.color, -40));

        // Draw glow effect
        this.ctx.shadowColor = player.color;
        this.ctx.shadowBlur = 15;
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(segment.x + 1, segment.y + 1, 18, 18);
        this.ctx.shadowBlur = 0;

        // Draw eyes
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(segment.x + 5, segment.y + 5, 3, 3);
        this.ctx.fillRect(segment.x + 12, segment.y + 5, 3, 3);

        // Eye pupils
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(segment.x + 6, segment.y + 6, 1, 1);
        this.ctx.fillRect(segment.x + 13, segment.y + 6, 1, 1);

        // Border
        this.ctx.strokeStyle = this.adjustColor(player.color, 50);
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(segment.x + 1, segment.y + 1, 18, 18);
    }

    drawSnakeBody(segment, player, index) {
        const gradient = this.ctx.createLinearGradient(
            segment.x, segment.y,
            segment.x + 20, segment.y + 20
        );

        const baseColor = this.adjustColor(player.color, -10 - (index * 2));
        const darkColor = this.adjustColor(baseColor, -20);

        gradient.addColorStop(0, baseColor);
        gradient.addColorStop(1, darkColor);

        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(segment.x + 2, segment.y + 2, 16, 16);

        // Add subtle inner highlight
        this.ctx.fillStyle = this.adjustColor(player.color, 30);
        this.ctx.fillRect(segment.x + 3, segment.y + 3, 14, 2);

        // Border
        this.ctx.strokeStyle = this.adjustColor(player.color, 20);
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(segment.x + 2, segment.y + 2, 16, 16);
    }

    drawFood(food, color, spawnTime, icon) {
        const now = Date.now();
        const age = spawnTime ? now - spawnTime : 0;
        const lifetime = 10000; // 10 seconds

        // Start blinking when food has 3 seconds left
        const shouldBlink = age > (lifetime - 3000);
        const blinkRate = 400; // Blink every 400ms
        const isVisible = !shouldBlink || Math.floor(now / blinkRate) % 2 === 0;

        if (!isVisible) return;

        // Change opacity as food gets older
        const opacity = shouldBlink ? 0.8 : 1.0;

        this.ctx.save();
        this.ctx.globalAlpha = opacity;

        // Draw background circle with glow
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 10;

        const gradient = this.ctx.createRadialGradient(
            food.x + 10, food.y + 10, 0,
            food.x + 10, food.y + 10, 10
        );
        gradient.addColorStop(0, color);
        gradient.addColorStop(0.7, this.adjustColor(color, -30));
        gradient.addColorStop(1, this.adjustColor(color, -60));

        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(food.x + 10, food.y + 10, 9, 0, Math.PI * 2);
        this.ctx.fill();

        // Reset shadow for icon
        this.ctx.shadowBlur = 0;

        // Draw icon
        this.ctx.font = '16px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(icon, food.x + 10, food.y + 10);

        // Border
        this.ctx.strokeStyle = this.adjustColor(color, 50);
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(food.x + 10, food.y + 10, 9, 0, Math.PI * 2);
        this.ctx.stroke();

        this.ctx.restore();
    }

    drawSpecialFoodGlow(food) {
        const time = Date.now() * 0.005;
        const glowRadius = 15 + Math.sin(time) * 5;

        this.ctx.save();
        this.ctx.globalAlpha = 0.3;
        this.ctx.fillStyle = '#ffd700';
        this.ctx.beginPath();
        this.ctx.arc(food.x + 10, food.y + 10, glowRadius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
    }

    drawSpeedEffect(player) {
        const head = player.snake[0];
        const time = Date.now() * 0.01;

        this.ctx.save();

        // Draw multiple glowing rings
        for (let i = 0; i < 3; i++) {
            this.ctx.globalAlpha = 0.4 - (i * 0.1);
            this.ctx.strokeStyle = '#ffff00';
            this.ctx.lineWidth = 3 - i;
            this.ctx.setLineDash([8, 4]);
            this.ctx.lineDashOffset = time + (i * 10);

            const offset = 3 + (i * 2);
            this.ctx.strokeRect(head.x - offset, head.y - offset, 20 + (offset * 2), 20 + (offset * 2));
        }

        // Add particle trail effect
        this.drawSpeedTrail(player);

        this.ctx.restore();
    }

    drawSpeedTrail(player) {
        if (player.snake.length < 2) return;

        const head = player.snake[0];
        const neck = player.snake[1];

        // Calculate direction
        const dx = head.x - neck.x;
        const dy = head.y - neck.y;

        // Draw trailing particles
        for (let i = 0; i < 5; i++) {
            const distance = (i + 1) * 8;
            const x = head.x + 10 - (dx * distance / 20);
            const y = head.y + 10 - (dy * distance / 20);

            this.ctx.save();
            this.ctx.globalAlpha = 0.8 - (i * 0.15);
            this.ctx.fillStyle = '#ffff00';
            this.ctx.beginPath();
            this.ctx.arc(x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4, 2 - (i * 0.3), 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        }
    }

    adjustColor(color, amount) {
        const hex = color.replace('#', '');
        const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount));
        const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount));
        const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount));
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    handleGameEnd(data) {
        document.getElementById('status').textContent = 'Game Over!';

        // Update the final player list to show champion status
        if (this.gameState && this.gameState.players) {
            this.updatePlayersList(null, this.gameState.players);
        }

        let message = 'Game Over!\n\n';
        if (data.winner) {
            message += `🏆 Champion: ${data.winner === this.playerId ? 'You!' : 'Player ' + data.winner}\n\n`;
        } else {
            message += 'No winner - all players eliminated!\n\n';
        }

        message += 'Final Results:\n';
        data.finalScores.forEach(score => {
            const status = score.alive ? '🏆 Champion' : '💀 Defeated';
            const playerLabel = score.id === this.playerId ? 'You' : 'Player';
            message += `${playerLabel}: Length ${score.score} (${status})\n`;
        });

        alert(message);

        setTimeout(() => {
            document.getElementById('status').textContent = 'Game ended. Waiting in room...';
            if (game.isHost) {
                document.getElementById('startBtn').disabled = false;
            }
        }, 1000);
    }
}

function startSoloPlay() {
    if (game && game.connected) {
        game.isSoloMode = true;
        game.socket.emit('createRoom');
    }
}

function createRoom() {
    if (game && game.connected) {
        game.socket.emit('createRoom');
    }
}

function joinRoom() {
    const roomCode = document.getElementById('roomCodeInput').value.trim();
    if (game && game.connected && roomCode) {
        game.socket.emit('joinRoom', { roomCode: roomCode });
    } else {
        alert('Please enter a room code');
    }
}

function startGame() {
    if (game && game.connected && game.isHost) {
        game.socket.emit('startGame');
    }
}

function leaveRoom() {
    if (game && game.connected) {
        game.showLobbyScreen();
        location.reload(); // Refresh to properly disconnect from room
    }
}

function copyRoomCode() {
    if (game && game.currentRoom) {
        navigator.clipboard.writeText(game.currentRoom).then(() => {
            alert('Room code copied to clipboard!');
        }).catch(() => {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = game.currentRoom;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            alert('Room code copied to clipboard!');
        });
    }
}

// Auto-uppercase room code input
document.addEventListener('DOMContentLoaded', () => {
    const roomCodeInput = document.getElementById('roomCodeInput');
    if (roomCodeInput) {
        roomCodeInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });

        roomCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                joinRoom();
            }
        });
    }
});

function showGameMechanics() {
    document.getElementById('mechanicsModal').style.display = 'block';
}

function hideGameMechanics() {
    document.getElementById('mechanicsModal').style.display = 'none';
}

// Close modal when clicking outside of it
window.onclick = function(event) {
    const modal = document.getElementById('mechanicsModal');
    if (event.target === modal) {
        hideGameMechanics();
    }
}

// Close modal with Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        hideGameMechanics();
    }
});

// Custom Snake Cursor with Trails
class CustomCursor {
    constructor() {
        this.cursor = document.querySelector('.custom-cursor');
        this.trails = [];
        this.maxTrails = 5;
        this.mouseX = 0;
        this.mouseY = 0;

        this.init();
    }

    init() {
        // Create trail elements
        for (let i = 0; i < this.maxTrails; i++) {
            const trail = document.createElement('div');
            trail.className = 'cursor-trail';
            trail.style.opacity = (1 - (i * 0.2)).toString();
            trail.style.transform = `scale(${1 - (i * 0.15)})`;
            document.body.appendChild(trail);
            this.trails.push({
                element: trail,
                x: 0,
                y: 0
            });
        }

        // Mouse move event
        document.addEventListener('mousemove', (e) => {
            this.mouseX = e.clientX;
            this.mouseY = e.clientY;
            this.updateCursor();
        });

        // Mouse leave event
        document.addEventListener('mouseleave', () => {
            this.cursor.style.opacity = '0';
            this.trails.forEach(trail => {
                trail.element.style.opacity = '0';
            });
        });

        // Mouse enter event
        document.addEventListener('mouseenter', () => {
            this.cursor.style.opacity = '1';
        });

        // Start animation loop
        this.animate();
    }

    updateCursor() {
        this.cursor.style.left = this.mouseX - 10 + 'px';
        this.cursor.style.top = this.mouseY - 10 + 'px';
        this.cursor.style.opacity = '1';
    }

    animate() {
        // Update trail positions with delay
        for (let i = this.trails.length - 1; i > 0; i--) {
            this.trails[i].x += (this.trails[i - 1].x - this.trails[i].x) * 0.3;
            this.trails[i].y += (this.trails[i - 1].y - this.trails[i].y) * 0.3;

            this.trails[i].element.style.left = this.trails[i].x - 6 + 'px';
            this.trails[i].element.style.top = this.trails[i].y - 6 + 'px';
        }

        // Update first trail to follow cursor closely
        this.trails[0].x += (this.mouseX - this.trails[0].x) * 0.5;
        this.trails[0].y += (this.mouseY - this.trails[0].y) * 0.5;
        this.trails[0].element.style.left = this.trails[0].x - 6 + 'px';
        this.trails[0].element.style.top = this.trails[0].y - 6 + 'px';

        requestAnimationFrame(() => this.animate());
    }
}

// Initialize custom cursor
const customCursor = new CustomCursor();

const game = new SnakeClient();