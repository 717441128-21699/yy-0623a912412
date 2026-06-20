import fs from 'fs';
import path from 'path';
import {
  TemperatureTask,
  TaskStation,
  CheckItem,
  CheckReport,
  ExceptionRecord,
} from '../types';

const dbDir = path.join(__dirname, '..', '..', 'data');
const dbFile = path.join(dbDir, 'cold_chain_db.json');

interface DatabaseData {
  tasks: TemperatureTask[];
  stations: TaskStation[];
  checkItems: CheckItem[];
  reports: CheckReport[];
  exceptions: ExceptionRecord[];
}

let db: DatabaseData = {
  tasks: [],
  stations: [],
  checkItems: [],
  reports: [],
  exceptions: [],
};

let initialized = false;

function ensureDbDir() {
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

function loadFromFile() {
  if (fs.existsSync(dbFile)) {
    try {
      const content = fs.readFileSync(dbFile, 'utf-8');
      const loaded = JSON.parse(content);
      db = {
        tasks: loaded.tasks || [],
        stations: loaded.stations || [],
        checkItems: loaded.checkItems || [],
        reports: loaded.reports || [],
        exceptions: loaded.exceptions || [],
      };
    } catch (e) {
      console.warn('Failed to load database file, starting with empty data');
    }
  }
}

function saveToFile() {
  ensureDbDir();
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf-8');
}

export function initDatabase() {
  if (initialized) return;
  ensureDbDir();
  loadFromFile();
  initialized = true;
  console.log('Database initialized');
}

function save() {
  saveToFile();
}

export const dbStore = {
  get tasks(): TemperatureTask[] {
    return db.tasks;
  },

  get stations(): TaskStation[] {
    return db.stations;
  },

  get checkItems(): CheckItem[] {
    return db.checkItems;
  },

  get reports(): CheckReport[] {
    return db.reports;
  },

  get exceptions(): ExceptionRecord[] {
    return db.exceptions;
  },

  addTask(task: TemperatureTask): void {
    db.tasks.push(task);
    save();
  },

  addStation(station: TaskStation): void {
    db.stations.push(station);
    save();
  },

  addCheckItem(item: CheckItem): void {
    db.checkItems.push(item);
    save();
  },

  addReport(report: CheckReport): void {
    db.reports.push(report);
    save();
  },

  addException(exception: ExceptionRecord): void {
    db.exceptions.push(exception);
    save();
  },

  updateTask(taskId: string, updates: Partial<TemperatureTask>): void {
    const idx = db.tasks.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      db.tasks[idx] = { ...db.tasks[idx], ...updates };
      save();
    }
  },

  updateStation(stationId: string, updates: Partial<TaskStation>): void {
    const idx = db.stations.findIndex((s) => s.id === stationId);
    if (idx !== -1) {
      db.stations[idx] = { ...db.stations[idx], ...updates };
      save();
    }
  },

  updateCheckItem(itemId: string, updates: Partial<CheckItem>): void {
    const idx = db.checkItems.findIndex((i) => i.id === itemId);
    if (idx !== -1) {
      db.checkItems[idx] = { ...db.checkItems[idx], ...updates };
      save();
    }
  },

  updateException(exceptionId: string, updates: Partial<ExceptionRecord>): void {
    const idx = db.exceptions.findIndex((e) => e.id === exceptionId);
    if (idx !== -1) {
      db.exceptions[idx] = { ...db.exceptions[idx], ...updates };
      save();
    }
  },
};

initDatabase();
