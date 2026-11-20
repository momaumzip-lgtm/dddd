// Independent reference specification retained to check SQL behavior. Test use only.
export const referenceScripts: Record<string, string> = {
  admit: `
if redis.call('EXISTS',KEYS[1])==1 then return 2 end
if redis.call('EXISTS',KEYS[2])==1 then return 3 end
local revision=tonumber(redis.call('GET',KEYS[6]) or '0')
if revision~=tonumber(ARGV[4]) then return 4 end
for i=3,5 do if tonumber(redis.call('GET',KEYS[i]) or '0')>=tonumber(ARGV[i-2]) then return 1 end end
redis.call('SET',KEYS[1],ARGV[5],'EX',86400)
redis.call('SET',KEYS[2],ARGV[5],'EX',180)
for i=3,5 do redis.call('INCR',KEYS[i]); redis.call('EXPIRE',KEYS[i],i==3 and 65 or 90000) end
return 0`,
  extra: `
if redis.call('GET',KEYS[1])~=ARGV[1] then return 3 end
if tonumber(redis.call('GET',KEYS[2]) or '0')>=tonumber(ARGV[2]) then return 1 end
redis.call('INCR',KEYS[2]); redis.call('EXPIRE',KEYS[2],90000); return 0`,
  finish: `
if redis.call('GET',KEYS[1])~=ARGV[1] then return 3 end
if ARGV[2]~='' then redis.call('SET',KEYS[2],ARGV[2],'EX',86400) end
redis.call('DEL',KEYS[1]);return 0`,
  stage_reply: `
if redis.call('GET',KEYS[1])~=ARGV[1] then return 3 end
if tonumber(redis.call('GET',KEYS[2]) or '0')~=tonumber(ARGV[2])-1 then return 4 end
redis.call('SET',KEYS[3],ARGV[2],'EX',7200)
redis.call('DEL',KEYS[1]);return 0`,
  ack_reply: `
if tonumber(redis.call('GET',KEYS[2]) or '0')==tonumber(ARGV[2]) and redis.call('GET',KEYS[3])==ARGV[1] then return 0 end
if redis.call('GET',KEYS[1])~=ARGV[2] or tonumber(redis.call('GET',KEYS[2]) or '0')~=tonumber(ARGV[2])-1 then return 4 end
redis.call('SET',KEYS[2],ARGV[2],'EX',86400)
redis.call('SET',KEYS[3],ARGV[1],'EX',7200)
redis.call('DEL',KEYS[1]);return 0`,
  survey_admit: `
local claim=redis.call('GET',KEYS[1])
if redis.call('EXISTS',KEYS[3])==1 then if claim==ARGV[1] then return 2 else return 3 end end
if claim and claim~=ARGV[1] then return 4 end
if redis.call('EXISTS',KEYS[2])==1 then return 5 end
if tonumber(redis.call('GET',KEYS[6]) or '0')>=1 then return 6 end
if not claim then
 if tonumber(redis.call('GET',KEYS[4]) or '0')>=3 or tonumber(redis.call('GET',KEYS[5]) or '0')>=tonumber(ARGV[2]) then return 1 end
 redis.call('SET',KEYS[1],ARGV[1],'EX',7200)
 for i=4,5 do redis.call('INCR',KEYS[i]);redis.call('EXPIRE',KEYS[i],90000) end
end
redis.call('INCR',KEYS[6]);redis.call('EXPIRE',KEYS[6],7200)
redis.call('SET',KEYS[2],ARGV[1],'EX',30)
return 0`,
  survey_finish: `
if redis.call('GET',KEYS[1])~=ARGV[1] then return 5 end
if ARGV[2]=='done' then redis.call('SET',KEYS[2],'1','EX',7200) end
redis.call('DEL',KEYS[1]);return 0`,
};
