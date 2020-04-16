/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Persistence, PersistedBlob } from '../persistence';
import { User } from '../../model/user';
import { ApiKey, AppName, Auth } from '../../model/auth';
import { inMemoryPersistence } from './in_memory';
import { UserImpl } from '../user/user_impl';

export const AUTH_USER_KEY_NAME_ = 'authUser';
export const PERSISTENCE_KEY_NAME_ = 'persistence';
const PERSISTENCE_NAMESPACE_ = 'firebase';

export function persistenceKeyName_(
  key: string,
  apiKey: ApiKey,
  appName: AppName
): string {
  return `${PERSISTENCE_NAMESPACE_}:${key}:${apiKey}:${appName}`;
}

export class PersistenceUserManager {
  private readonly fullUserKey: string;
  private readonly fullPersistenceKey: string;
  private constructor(
    public persistence: Persistence,
    private readonly auth: Auth,
    private readonly userKey: string
  ) {
    const {config, name} = this.auth;
    this.fullUserKey = persistenceKeyName_(this.userKey, config.apiKey, name);
    this.fullPersistenceKey = persistenceKeyName_(PERSISTENCE_KEY_NAME_, config.apiKey, name);
  }


  setCurrentUser(user: User): Promise<void> {
    return this.persistence.set(this.fullUserKey, user);
  }

  getCurrentUser(): Promise<User | null> {
    return this.persistence.get<User>(
      this.fullUserKey,
      (blob: PersistedBlob) => UserImpl.fromPlainObject(this.auth, blob)
    );
  }

  removeCurrentUser(): Promise<void> {
    return this.persistence.remove(this.fullUserKey);
  }

  savePersistenceForRedirect(): Promise<void> {
    return this.persistence.set(
      this.fullPersistenceKey,
      this.persistence.type
    );
  }

  async setPersistence(newPersistence: Persistence): Promise<void> {
    if (this.persistence.type === newPersistence.type) {
      return;
    }

    const currentUser = await this.getCurrentUser();
    await this.removeCurrentUser();

    this.persistence = newPersistence;

    if (currentUser) {
      return this.setCurrentUser(currentUser);
    }
  }

  static async create(
    auth: Auth,
    persistenceHierarchy: Persistence[],
    userKey = AUTH_USER_KEY_NAME_
  ): Promise<PersistenceUserManager> {
    if (!persistenceHierarchy.length) {
      return new PersistenceUserManager(inMemoryPersistence, auth, userKey);
    }

    const key = persistenceKeyName_(userKey, auth.config.apiKey, auth.name);
    for (const persistence of persistenceHierarchy) {
      if (await persistence.get<User>(key)) {
        return new PersistenceUserManager(persistence, auth, userKey);
      }
    }

    // Check all the available storage options.
    // TODO: Migrate from local storage to indexedDB
    // TODO: Clear other forms once one is found

    // All else failed, fall back to zeroth persistence
    // TODO: Modify this to support non-browser devices
    return new PersistenceUserManager(persistenceHierarchy[0], auth, userKey);
  }
}
