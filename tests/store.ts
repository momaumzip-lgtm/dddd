import { createRequire } from "node:module";
import type { Store } from "../lib/server/limits";
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
// Runs the ACTUAL production Lua against an expiring Redis command double. No network or paid calls.
export class LuaStore implements Store {
  data = new Map<string, { value: string; until: number }>();
  now = Date.now();
  get(key: string) {
    const item = this.data.get(key);
    if (!item || item.until <= this.now) {
      this.data.delete(key);
      return undefined;
    }
    return item.value;
  }
  async eval(script: string, keys: string[], args: string[]) {
    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);
    const table = (name: string, list: string[]) => {
      lua.lua_newtable(L);
      list.forEach((value, i) => {
        lua.lua_pushstring(L, to_luastring(value));
        lua.lua_rawseti(L, -2, i + 1);
      });
      lua.lua_setglobal(L, to_luastring(name));
    };
    table("KEYS", keys);
    table("ARGV", args);
    lua.lua_newtable(L);
    lua.lua_pushcfunction(L, (vm: any) => {
      const parts: string[] = [];
      for (let i = 1; i <= lua.lua_gettop(vm); i++)
        parts.push(to_jsstring(lua.lua_tolstring(vm, i)));
      const [command, key, ...rest] = parts;
      let value: string | number | undefined;
      if (command === "EXISTS") value = this.get(key) === undefined ? 0 : 1;
      else if (command === "GET") value = this.get(key);
      else if (command === "SET") {
        this.data.set(key, { value: rest[0], until: this.now + Number(rest[2]) * 1000 });
        value = "OK";
      } else if (command === "INCR") {
        value = Number(this.get(key) || 0) + 1;
        this.data.set(key, { value: String(value), until: this.data.get(key)?.until || Infinity });
      } else if (command === "EXPIRE") {
        const item = this.data.get(key);
        if (item) item.until = this.now + Number(rest[0]) * 1000;
        value = item ? 1 : 0;
      } else if (command === "DEL") {
        value = this.data.delete(key) ? 1 : 0;
      } else throw new Error("Unexpected Redis command");
      if (value === undefined) lua.lua_pushboolean(vm, false);
      else if (typeof value === "number") lua.lua_pushnumber(vm, value);
      else lua.lua_pushstring(vm, to_luastring(value));
      return 1;
    });
    lua.lua_setfield(L, -2, to_luastring("call"));
    lua.lua_setglobal(L, to_luastring("redis"));
    const status = lauxlib.luaL_dostring(L, to_luastring(script));
    if (status !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
    const result = lua.lua_tonumber(L, -1);
    lua.lua_close(L);
    return result;
  }
}
