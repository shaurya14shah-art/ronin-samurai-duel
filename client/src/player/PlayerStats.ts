export interface BaseStats {
    strength: number;
    agility: number;
    vitality: number;
    endurance: number;
}

export class PlayerStats {
    // Core attributes
    public baseStats: BaseStats;

    // Derived resources
    public maxHp: number;
    public currentHp: number;

    public maxStamina: number;
    public currentStamina: number;
    
    public maxComposure: number;
    public currentComposure: number;
    
    public onFootstep?: (sprinting: boolean) => void;

    // Regeneration and Drain rates
    public staminaRegenRate: number; // per second
    public hpRegenRate: number; // per second
    public composureRegenRate: number; // per second

    private staminaRegenDelay: number = 0;
    private readonly STAMINA_REGEN_COOLDOWN: number = 1.0; // Seconds before regen starts after drain
    
    private composureRegenDelay: number = 0;
    private readonly COMPOSURE_REGEN_COOLDOWN: number = 2.0;

    constructor(initialStats?: Partial<BaseStats>) {
        this.baseStats = {
            strength: initialStats?.strength ?? 10,
            agility: initialStats?.agility ?? 10,
            vitality: initialStats?.vitality ?? 10,
            endurance: initialStats?.endurance ?? 10,
        };

        this.maxHp = this.calculateMaxHp();
        this.currentHp = this.maxHp;

        this.maxStamina = this.calculateMaxStamina();
        this.currentStamina = this.maxStamina;
        
        this.maxComposure = this.calculateMaxComposure();
        this.currentComposure = this.maxComposure;

        this.hpRegenRate = this.calculateHpRegenRate();
        this.staminaRegenRate = this.calculateStaminaRegenRate();
        this.composureRegenRate = this.calculateComposureRegenRate();
    }

    private calculateMaxHp(): number {
        // Base 100 + 10 per vitality
        return 100 + (this.baseStats.vitality * 10);
    }

    private calculateMaxStamina(): number {
        // Base 50 + 5 per endurance
        return 50 + (this.baseStats.endurance * 5);
    }
    
    private calculateMaxComposure(): number {
        // Base 100 + 5 per endurance + 5 per vitality
        return 100 + (this.baseStats.endurance * 5) + (this.baseStats.vitality * 5) + Math.max(0, this.baseStats.strength - 10) * 3;
    }

    private calculateHpRegenRate(): number {
        // Base 1 + 0.1 per vitality
        return 1 + (this.baseStats.vitality * 0.1);
    }

    private calculateStaminaRegenRate(): number {
        // Base 5 + 0.5 per endurance
        return 5 + (this.baseStats.endurance * 0.5) + Math.max(0, this.baseStats.agility - 10) * 0.25;
    }
    
    private calculateComposureRegenRate(): number {
        // Base 10 + 1 per endurance
        return 10 + (this.baseStats.endurance * 1.0);
    }

    /**
     * Recalculates maximums based on current base stats,
     * maintaining the current value or adding the difference.
     */
    public recalculateDerivedStats(): void {
        const oldMaxHp = this.maxHp;
        const oldMaxStamina = this.maxStamina;
        const oldMaxComposure = this.maxComposure;

        this.maxHp = this.calculateMaxHp();
        this.maxStamina = this.calculateMaxStamina();
        this.maxComposure = this.calculateMaxComposure();
        
        this.hpRegenRate = this.calculateHpRegenRate();
        this.staminaRegenRate = this.calculateStaminaRegenRate();
        this.composureRegenRate = this.calculateComposureRegenRate();

        // Add the difference in max values to current values
        this.currentHp += Math.max(0, this.maxHp - oldMaxHp);
        this.currentStamina += Math.max(0, this.maxStamina - oldMaxStamina);
        this.currentComposure += Math.max(0, this.maxComposure - oldMaxComposure);

        // Ensure current values don't exceed max
        this.currentHp = Math.min(this.currentHp, this.maxHp);
        this.currentStamina = Math.min(this.currentStamina, this.maxStamina);
        this.currentComposure = Math.min(this.currentComposure, this.maxComposure);
    }

    /**
     * Reduces HP by a specified amount.
     * @param amount The damage to take.
     */
    public takeDamage(amount: number): void {
        if (amount < 0) return;
        this.currentHp = Math.max(0, this.currentHp - amount);
        this.reduceComposure(amount * 1.5);
    }
    
    /**
     * Reduces composure based on poorly blocked attacks or receiving hits.
     * @param amount The composure damage to take.
     */
    public reduceComposure(amount: number): void {
        if (amount <= 0) return;
        this.currentComposure = Math.max(0, this.currentComposure - amount);
        this.composureRegenDelay = this.COMPOSURE_REGEN_COOLDOWN;
    }
    
    public blockPoorly(damageAmount: number): void {
        this.reduceComposure(damageAmount * 2.0); // Blocking poorly heavily damages composure
    }

    public getComposureRatio(): number {
        return this.maxComposure > 0 ? this.currentComposure / this.maxComposure : 1;
    }

    public getStaminaRatio(): number {
        return this.maxStamina > 0 ? this.currentStamina / this.maxStamina : 1;
    }

    public getHealthRatio(): number {
        return this.maxHp > 0 ? this.currentHp / this.maxHp : 1;
    }

    public isExhausted(): boolean {
        return this.currentStamina < this.maxStamina * 0.2;
    }

    public isPanicked(): boolean {
        return this.currentComposure < this.maxComposure * 0.2;
    }

    /**
     * Restores HP by a specified amount.
     * @param amount The health to restore.
     */
    public heal(amount: number): void {
        if (amount < 0) return;
        this.currentHp = Math.min(this.maxHp, this.currentHp + amount);
    }

    /**
     * Attempts to drain a specific amount of stamina.
     * @param amount The stamina to consume.
     * @returns True if successful, false if not enough stamina.
     */
    public drainStamina(amount: number): boolean {
        if (amount < 0) return false;
        
        // Vulnerability/cost scaling based on low composure
        const composureRatio = this.maxComposure > 0 ? this.currentComposure / this.maxComposure : 1;
        // If composure is very low (e.g. 0), actions cost 50% more stamina
        const staminaCostMultiplier = 1.0 + (0.5 * (1 - composureRatio));
        const finalAmount = amount * staminaCostMultiplier;
        
        if (this.currentStamina >= finalAmount) {
            this.currentStamina -= finalAmount;
            this.staminaRegenDelay = this.STAMINA_REGEN_COOLDOWN;
            return true;
        }
        return false;
    }

    /**
     * Updates background regeneration of stats over time.
     * @param dt Delta time in seconds since last frame.
     */
    public update(dt: number): void {
        if (dt <= 0) return;
        
        // Handle composure delay and regen
        if (this.composureRegenDelay > 0) {
            this.composureRegenDelay -= dt;
        } else {
            if (this.currentComposure < this.maxComposure) {
                this.currentComposure += this.composureRegenRate * dt;
                if (this.currentComposure > this.maxComposure) {
                    this.currentComposure = this.maxComposure;
                }
            }
        }

        // Handle stamina delay and regen
        if (this.staminaRegenDelay > 0) {
            this.staminaRegenDelay -= dt;
        } else {
            if (this.currentStamina < this.maxStamina) {
                // Stamina regen is penalized by low composure
                const composureRatio = this.maxComposure > 0 ? this.currentComposure / this.maxComposure : 1;
                // Minimum 20% regen rate when composure is 0
                const regenMultiplier = 0.2 + (0.8 * composureRatio);
                
                this.currentStamina += (this.staminaRegenRate * regenMultiplier) * dt;
                if (this.currentStamina > this.maxStamina) {
                    this.currentStamina = this.maxStamina;
                }
            }
        }

        // Handle HP regen (optional passive healing)
        if (this.currentHp > 0 && this.currentHp < this.maxHp) {
            this.currentHp += this.hpRegenRate * dt;
            if (this.currentHp > this.maxHp) {
                this.currentHp = this.maxHp;
            }
        }
    }
}
