import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function database(path=':memory:'){
  const sql=new DatabaseSync(path);sql.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
  class Statement{
    constructor(query,args=[]){this.query=query;this.args=args;}
    bind(...args){return new Statement(this.query,args);}
    async first(){return sql.prepare(this.query).get(...this.args)||null;}
    async all(){return{results:sql.prepare(this.query).all(...this.args)};}
    async run(){const result=sql.prepare(this.query).run(...this.args);return{success:true,meta:{changes:Number(result.changes)}};}
  }
  return{sql,prepare:query=>new Statement(query),async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
}
